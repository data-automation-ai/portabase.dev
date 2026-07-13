terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.0" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_project_service" "required" {
  for_each = toset([
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iap.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "portabase" {
  account_id   = "portabase-runner"
  display_name = "PortaBase customer-owned backup runner"
  depends_on   = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "read_source" {
  secret_id = var.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.portabase.email}"
}

resource "google_compute_firewall" "iap_ssh" {
  name          = "portabase-iap-ssh"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["portabase-iap-ssh"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_instance" "portabase" {
  name         = var.instance_name
  machine_type = var.machine_type
  tags         = ["portabase-iap-ssh"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {}
  }

  service_account {
    email  = google_service_account.portabase.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = templatefile("${path.module}/startup.sh.tftpl", {
      package_url       = var.package_url
      package_sha256    = lower(var.package_sha256)
      project_id        = var.project_id
      project_ref       = var.supabase_project_ref
      secret_id         = var.secret_id
      destination_path  = var.destination_path
      rclone_remote     = var.rclone_remote
      schedule_hours    = var.schedule_hours
    })
  }

  depends_on = [google_secret_manager_secret_iam_member.read_source, google_project_service.required]
}
