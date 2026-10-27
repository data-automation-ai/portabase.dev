import {controllerServer} from './controller.mjs';
import {admitJob} from './cloud-config.mjs';
const list=(process.env.VALIDATION_CUSTOMERS||'').split(',').filter(Boolean);
// Until the public onboarding flow passes, only explicitly listed synthetic
// customer accounts can allocate compute through this candidate deployment.
if(!list.length || list.some(id=>!/^[a-f0-9-]{36}$/i.test(id)))throw new Error('validation_customers_required');
controllerServer({allowedCustomers:new Set(list),
  admit:input=>admitJob({...input,operation:'runner.start'})}).listen(Number(process.env.PORT||8080),'0.0.0.0');
