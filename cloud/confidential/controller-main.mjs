import {controllerServer,controllerCustomerPolicy} from './controller.mjs';
import {admitJob} from './cloud-config.mjs';
// Validation remains default. Operator enables public mode only after isolated
// onboarding proof; verified customer identity and paid admission still apply.
controllerServer({allowedCustomers:controllerCustomerPolicy(),
  admit:input=>admitJob({...input,operation:'runner.start'})}).listen(Number(process.env.PORT||8080),'0.0.0.0');
