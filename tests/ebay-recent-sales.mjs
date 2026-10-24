import assert from 'node:assert/strict';
import {parseSoldDate,recentSoldItems} from '../api/ebay-sold.js';
let passed=0;
function equal(actual,expected,message){assert.deepEqual(actual,expected,message);passed++;}
const now=Date.parse('2026-10-24T16:00:00Z');
equal(parseSoldDate('Sold Oct 23, 2026',now),'2026-10-23','explicit date');
for(const text of ['Ended Oct 23, 2026','Sold yesterday','Sold Feb 30, 2026','Sold Oct 25, 2026','Sold Oct 23'])
  equal(parseSoldDate(text,now),null,'undated, invalid and future sales are excluded');
function item(id,opts={}) {
 const {date='Oct 23, 2026',title='Mew 76/214 Near Mint',price='$10.00',extra=''}=opts;
 return `<li class="s-item"><span class="s-item__title">${title}</span><span class="s-item__price">${price}</span><span>Sold ${date}</span>${extra}<a href="https://www.ebay.com/itm/${id}?track=1"></a></li>`;
}
const html=item(1)+item(1)+item(2,{date:'Oct 22, 2026'})+item(3,{date:'Sep 1, 2026'})+
 item(4,{date:'unknown'})+item(5,{extra:'Best offer accepted'})+item(6,{price:'$8.00 to $20.00'})+
 item(7,{price:'C $10.00'})+item(8,{title:'Mew card lot of 10'})+item(9,{title:'Mew proxy'})+
 item(10,{date:'Oct 24, 2026',price:'$0.25'});
const sales=recentSoldItems(html,{now,days:30});
equal(sales.map(x=>x.itemId),['10','1','2'],'dated, distinct, exact prices ordered most recent first');
equal(sales[0].price,.25,'real low-value cards are supported');
equal(sales.every(x=>x.currency==='USD'&&x.shippingIncluded===false),true,'item prices do not silently include unknown shipping');
equal(recentSoldItems(html,{now,days:90}).map(x=>x.itemId),['10','1','2','3'],'time window changes the sample');
equal(recentSoldItems(item(20,{date:'Oct 10, 2026'}),{now,days:7}),[],'seven-day sample excludes older sales');
console.log(`ebay-recent-sales: ${passed} passed, 0 failed -- SUITE COMPLETE, exit=0`);
