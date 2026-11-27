export type DemoCustomer = {
  id: string; firstName: string; lastName: string; email: string; phone: string; createdAt: string;
};
export type DemoOrderItem = { id: string; productName: string; quantity: number; image: string };
export type DemoOrder = {
  id: string; orderNumber: string; status: "PROCESSING"|"FULFILLED"|"COMPLETED"|"CANCELLED";
  totalAmount: number; currency: "NGN"; createdAt: string; items: DemoOrderItem[];
  paymentStatus: "PAID"|"REFUNDED"|"NOT_PAID"; paymentMethod: string; transactionReference: string;
  deliveryAddress: string; deliveryEstimate: string; trackingEvents: Array<{label:string;date:string;complete:boolean}>;
};
export type DemoAddress = {id:string;label:string;recipient:string;phone:string;street:string;area:string;city:string;state:string;default:boolean};
export type DemoTicket = {id:string;subject:string;orderNumber:string;category:string;message:string;status:"OPEN"|"IN_PROGRESS"|"RESOLVED";createdAt:string};
const CUSTOMER_KEY="ccb-demo-customer", SESSION_KEY="ccb-demo-session";
const ADDRESS_KEY="ccb-demo-addresses", TICKET_KEY="ccb-demo-tickets", WISHLIST_KEY="ccb-demo-wishlist", REVIEW_KEY="ccb-demo-reviews";
const defaultAddresses:DemoAddress[]=[
 {id:"addr-home",label:"Home",recipient:"Demo Customer",phone:"08000000000",street:"12 Admiralty Way",area:"Lekki Phase 1",city:"Lagos",state:"Lagos",default:true},
 {id:"addr-office",label:"Office",recipient:"Demo Customer",phone:"08000000000",street:"Plot 18, Ahmadu Bello Way",area:"Central Business District",city:"Abuja",state:"FCT",default:false}
];
const demoOrders:DemoOrder[]=[
 {id:"demo-1",orderNumber:"CCB-104583",status:"PROCESSING",totalAmount:125000,currency:"NGN",createdAt:"2026-11-20T10:30:00.000Z",items:[{id:"i1",productName:"Smart Watch",quantity:2,image:"/products/1g.png"},{id:"i2",productName:"Laptop",quantity:1,image:"/products/1p.png"}],paymentStatus:"PAID",paymentMethod:"Paystack",transactionReference:"DEMO-PAY-104583",deliveryAddress:"12 Admiralty Way, Lekki Phase 1, Lagos",deliveryEstimate:"Estimate pending dispatch",trackingEvents:[{label:"Order placed",date:"20 Nov 2026",complete:true},{label:"Payment confirmed",date:"20 Nov 2026",complete:true},{label:"Processing",date:"In progress",complete:true},{label:"Dispatched",date:"Pending",complete:false},{label:"Delivered",date:"Pending",complete:false}]},
 {id:"demo-2",orderNumber:"CCB-104112",status:"COMPLETED",totalAmount:210000,currency:"NGN",createdAt:"2026-11-12T10:30:00.000Z",items:[{id:"i3",productName:"Digital Camera",quantity:1,image:"/products/2g.png"}],paymentStatus:"PAID",paymentMethod:"Paystack",transactionReference:"DEMO-PAY-104112",deliveryAddress:"12 Admiralty Way, Lekki Phase 1, Lagos",deliveryEstimate:"Delivered 16 Nov 2026",trackingEvents:[{label:"Order placed",date:"12 Nov 2026",complete:true},{label:"Payment confirmed",date:"12 Nov 2026",complete:true},{label:"Processing",date:"13 Nov 2026",complete:true},{label:"Dispatched",date:"15 Nov 2026",complete:true},{label:"Delivered",date:"16 Nov 2026",complete:true}]},
 {id:"demo-3",orderNumber:"CCB-103807",status:"CANCELLED",totalAmount:28000,currency:"NGN",createdAt:"2026-11-02T10:30:00.000Z",items:[{id:"i4",productName:"Wireless Earbuds",quantity:2,image:"/products/3b.png"}],paymentStatus:"REFUNDED",paymentMethod:"Paystack",transactionReference:"DEMO-PAY-103807",deliveryAddress:"12 Admiralty Way, Lekki Phase 1, Lagos",deliveryEstimate:"Cancelled",trackingEvents:[{label:"Order placed",date:"2 Nov 2026",complete:true},{label:"Cancelled",date:"3 Nov 2026",complete:true}]}
];
export const demoProducts=[
 {id:"p1",name:"Smart Watch",price:75000,image:"/products/1g.png",tag:"Popular"},
 {id:"p2",name:"Wireless Headphones",price:48000,image:"/products/2g.png",tag:"Recommended"},
 {id:"p3",name:"Home Coffee Maker",price:39500,image:"/products/3b.png",tag:"New find"},
 {id:"p4",name:"Everyday Backpack",price:26000,image:"/products/4p.png",tag:"Recommended"}
];
export function registerDemoCustomer(input:Omit<DemoCustomer,"id"|"createdAt">):DemoCustomer{
 const customer={...input,id:`demo-${Date.now()}`,createdAt:new Date().toISOString()};
 localStorage.setItem(CUSTOMER_KEY,JSON.stringify(customer));localStorage.setItem(SESSION_KEY,"active");
 localStorage.setItem(ADDRESS_KEY,JSON.stringify(defaultAddresses.map(a=>({...a,recipient:`${customer.firstName} ${customer.lastName}`,phone:customer.phone||a.phone}))));
 return customer;
}
export function loginDemoCustomer(email:string):DemoCustomer{
 const saved=localStorage.getItem(CUSTOMER_KEY);let customer:DemoCustomer|null=null;
 if(saved){try{customer=JSON.parse(saved) as DemoCustomer}catch{localStorage.removeItem(CUSTOMER_KEY)}}
 if(!customer||customer.email.toLowerCase()!==email.trim().toLowerCase()){
  customer={id:"demo-customer-001",firstName:"Demo",lastName:"Customer",email:email.trim().toLowerCase(),phone:"",createdAt:new Date().toISOString()};
  localStorage.setItem(CUSTOMER_KEY,JSON.stringify(customer));
 }
 localStorage.setItem(SESSION_KEY,"active");return customer;
}
export function getDemoCustomer():DemoCustomer|null{
 if(typeof window==="undefined"||localStorage.getItem(SESSION_KEY)!=="active")return null;
 try{return JSON.parse(localStorage.getItem(CUSTOMER_KEY)||"null") as DemoCustomer|null}catch{return null}
}
export function updateDemoCustomer(customer:DemoCustomer){localStorage.setItem(CUSTOMER_KEY,JSON.stringify(customer))}
export function logoutDemoCustomer(){localStorage.removeItem(SESSION_KEY)}
export function getDemoOrders(){return demoOrders}
export function getDemoOrder(orderNumber:string){return demoOrders.find(o=>o.orderNumber===orderNumber)}
export function getDemoWishlist(){try{return JSON.parse(localStorage.getItem(WISHLIST_KEY)||'["p1","p2","p3","p4"]') as string[]}catch{return ["p1","p2","p3","p4"]}}
export function toggleDemoWishlist(id:string){const ids=getDemoWishlist();const next=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];localStorage.setItem(WISHLIST_KEY,JSON.stringify(next));return next}
export function getDemoWishlistCount(){return getDemoWishlist().length}
export function getDemoUnreadCount(){return 2}
export function getDemoAddresses():DemoAddress[]{try{return JSON.parse(localStorage.getItem(ADDRESS_KEY)||"null") as DemoAddress[]||defaultAddresses}catch{return defaultAddresses}}
export function saveDemoAddress(address:DemoAddress){const all=getDemoAddresses().filter(a=>a.id!==address.id);if(address.default)all.forEach(a=>a.default=false);localStorage.setItem(ADDRESS_KEY,JSON.stringify([...all,address]))}
export function deleteDemoAddress(id:string){localStorage.setItem(ADDRESS_KEY,JSON.stringify(getDemoAddresses().filter(a=>a.id!==id)))}
export function getDemoTickets():DemoTicket[]{try{return JSON.parse(localStorage.getItem(TICKET_KEY)||"[]") as DemoTicket[]}catch{return []}}
export function createDemoTicket(input:Omit<DemoTicket,"id"|"status"|"createdAt">){const tickets=getDemoTickets();const ticket={...input,id:`CCB-HELP-${Date.now().toString().slice(-6)}`,status:"OPEN" as const,createdAt:new Date().toISOString()};localStorage.setItem(TICKET_KEY,JSON.stringify([ticket,...tickets]));return ticket}
export function getDemoReviews(){try{return JSON.parse(localStorage.getItem(REVIEW_KEY)||"[]") as Array<{orderNumber:string;rating:number;comment:string}>}catch{return []}}
export function saveDemoReview(review:{orderNumber:string;rating:number;comment:string}){localStorage.setItem(REVIEW_KEY,JSON.stringify([...getDemoReviews(),review]))}
export function getDemoTransactions(){return demoOrders.map(o=>({id:o.transactionReference,orderNumber:o.orderNumber,amount:o.totalAmount,status:o.paymentStatus,method:o.paymentMethod,date:o.createdAt}))}
export const getDemoRewards=()=>({points:240,tier:"Everyday Member",nextTier:"Insider",pointsToNextTier:260});
