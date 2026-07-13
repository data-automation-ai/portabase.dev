output "instance_name" {
  value = google_compute_instance.portabase.name
}
output "instance_zone" {
  value = google_compute_instance.portabase.zone
}
output "service_account" {
  value = google_service_account.portabase.email
}
output "connect_command" {
  value = "gcloud compute ssh ${google_compute_instance.portabase.name} --zone ${google_compute_instance.portabase.zone} --tunnel-through-iap"
}
