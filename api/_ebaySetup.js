// Only fixed messages and numeric provider codes may leave this boundary.
// Provider descriptions can contain account data or request parameters.
export function sellerSetupIssue(check,error={}) {
  const labels={registration:'seller registration',fulfillment:'shipping policies',payment:'payment policies',return:'return policies',location:'inventory locations'};
  if(!Object.hasOwn(labels,check))throw Error('Unknown seller setup check');
  const reconnect=error.status===409;
  const policy=['fulfillment','payment','return'].includes(check);
  const issue={check,message:reconnect?'eBay authorization expired or was revoked. Reconnect eBay to continue.':
    policy?'eBay could not read your '+labels[check]+'. Check Business Policies in eBay, including enrollment and US policies, then check again.':
    'eBay could not confirm your '+labels[check]+'. Try this check again.'};
  if(Number.isInteger(error.providerStatus)&&error.providerStatus>=400&&error.providerStatus<=599)issue.providerStatus=error.providerStatus;
  if(Number.isInteger(error.providerErrorId)&&error.providerErrorId>=0&&error.providerErrorId<=1e9)issue.providerErrorId=error.providerErrorId;
  return issue;
}
