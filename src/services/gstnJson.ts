import { SalesInvoice } from '../types';
export const buildGstr1Summary=(invoices:SalesInvoice[],gstin:string,month:string)=>({gstin,fp:month.replace('-',''),b2b:invoices.filter(i=>i.debtorGstin).map(i=>({ctin:i.debtorGstin,inv:[{inum:i.invoiceNumber,idt:i.invoiceDate,val:i.grandTotal}]}))});
export const generateOfficialGstnJson=(summary:any)=>summary;