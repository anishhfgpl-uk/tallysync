import { TallyCompany, Debtor, StockItem, SalesInvoice } from '../types';
export const initialCompany: TallyCompany = { id:'company-1', name:'Anish Technologies', gstin:'07AAECA0000A1Z5', state:'Delhi', stateCode:'07', tallyHost:'http://127.0.0.1', tallyPort:9000, status:'offline' };
export const initialDebtors: Debtor[] = [];
export const initialItems: StockItem[] = [];
export const initialInvoices: SalesInvoice[] = [];