import {normalizeCreateInput} from '../api/drafts.js';
import {buildDraft,readStoredDraft} from '../api/_draftStore.js';
export const env={EBAY_APP_ID:'fixture-app',EBAY_CERT_ID:'fixture-cert',EBAY_SELLER_CONNECT_ENABLED:'true',EBAY_SELLER_TOKEN_KEY:'41'.repeat(32),EBAY_SELLER_REDIRECT_NAME:'fixture-runame',EBAY_SELLER_ORIGIN:'https://www.cardresell.org'};
export const makeDraft=(changes={})=>buildDraft(normalizeCreateInput({card:{name:'Charizard',set:'Base Set',number:'4/102',game:'Pokemon',condition:'Near Mint'},instanceId:'inst_col_fixture',slot:'ebay:fixed-price',price:12.5,priceSource:'seller',pricingContext:{feeModelRevision:1},...changes}));
export const draft=makeDraft(),read=readStoredDraft(draft);
export const reference={categoryId:'183454',treeId:'0',treeVersion:'fixture-v1',sellerRegistered:true,
 aspects:Object.entries({...read.packet.aspects.required,...read.packet.aspects.optional}).map(([name,values])=>({localizedAspectName:name,aspectConstraint:{aspectMode:name==='Game'?'SELECTION_ONLY':'FREE_TEXT',aspectDataType:'STRING',itemToAspectCardinality:'SINGLE',aspectRequired:name==='Game',aspectMaxLength:65},aspectValues:values.map(localizedValue=>({localizedValue}))})),
 condition:{conditionId:'4000',conditionDescriptors:[{conditionDescriptorId:'40001',conditionDescriptorName:'Card Condition',conditionDescriptorConstraint:{mode:'SELECTION_ONLY',cardinality:'SINGLE',usage:'REQUIRED'},conditionDescriptorValues:[{conditionDescriptorValueId:'400010',conditionDescriptorValueName:'Near mint or better'}]}]},
 fulfillmentPolicies:[{fulfillmentPolicyId:'fp1',name:'Tracked shipping',marketplaceId:'EBAY_US',shippingOptions:[{costType:'FLAT_RATE'}]}],
 paymentPolicies:[{paymentPolicyId:'pp1',name:'Payment policy',marketplaceId:'EBAY_US'}],returnPolicies:[{returnPolicyId:'rp1',name:'30-day returns',marketplaceId:'EBAY_US'}],
 locations:[{merchantLocationKey:'shelf1',name:'Card room',merchantLocationStatus:'ENABLED',location:{address:{postalCode:'12345',country:'US'}}}]};
export const selected={aspects:{},descriptors:{'40001':['400010']},fulfillmentPolicyId:'fp1',paymentPolicyId:'pp1',returnPolicyId:'rp1',merchantLocationKey:'shelf1',detailsConfirmed:true,copyAvailable:true,photoIds:['ph_front']};
export const photo={photoId:'ph_front',sha256:'a'.repeat(64),contentType:'image/jpeg',byteLength:2000};
export const verifiedPhotos=[{photoId:photo.photoId,url:'https://photos.example.test/fixture.jpg',sha256:photo.sha256}];
export const photoHost={ownerNamespace:owner=>'owner-'+owner,objectKey:({ownerNs,draftId,photoId,sha256,ext})=>[ownerNs,draftId,photoId,sha256+ext].join('/'),head:async()=>({exists:true,byteLength:2000,contentType:'image/jpeg'}),publicUrl:key=>'https://photos.example.test/'+key};
