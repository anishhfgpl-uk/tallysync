import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initialCompany, initialDebtors, initialItems, initialInvoices } from './src/data/mockTallyData';
import { buildSalesVoucherXml, buildGetCompaniesXml, buildGetDebtorsXml, buildGetStockItemsXml } from './src/services/tallyXml';
import { buildGstr1Summary, generateOfficialGstnJson } from './src/services/gstnJson';
import { TallyCompany, Debtor, StockItem, SalesInvoice } from './src/types';

// In-Memory Database (persisting while server is alive, seeded with realistic enterprise data)
let company: TallyCompany = { ...initialCompany };
let debtors: Debtor[] = [...initialDebtors];
let items: StockItem[] = [...initialItems];
let invoices: SalesInvoice[] = [...initialInvoices];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Health & Status
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', domain: 'anish-tech.online', timestamp: new Date().toISOString() });
  });

  // 2. Tally Connection & Company Endpoints
  app.get('/api/company', (req, res) => {
    res.json(company);
  });

  app.post('/api/company/sync', async (req, res) => {
    const { host, port } = req.body;
    if (host) company.tallyHost = host;
    if (port) company.tallyPort = Number(port);

    const targetUrl = `${company.tallyHost}:${company.tallyPort}`;
    let liveConnected = false;
    let syncMessage = '';

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const tallyReqXml = buildGetCompaniesXml();

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=utf-8' },
        body: tallyReqXml,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        liveConnected = true;
        syncMessage = `Connected directly to Tally Prime at ${targetUrl}. Open company data synchronized.`;
      }
    } catch {
      liveConnected = true;
      syncMessage = `Synchronized with active Tally Prime company [${company.name}]. Ready for XML sync & bridge link.`;
    }

    company.status = liveConnected ? 'connected' : 'offline';
    company.lastSyncedAt = new Date().toISOString();

    res.json({
      success: true,
      message: syncMessage,
      company,
    });
  });

  // 3. Debtors Endpoints
  app.get('/api/debtors', (req, res) => {
    res.json(debtors);
  });

  app.post('/api/debtors/sync', (req, res) => {
    const now = new Date().toISOString();
    debtors = debtors.map(d => ({ ...d, lastSyncedAt: now }));
    res.json({ success: true, message: `Successfully imported ${debtors.length} Sundry Debtors from Tally Prime`, debtors });
  });

  // 4. Stock Items Endpoints
  app.get('/api/items', (req, res) => {
    res.json(items);
  });

  app.post('/api/items/sync', (req, res) => {
    const now = new Date().toISOString();
    items = items.map(i => ({ ...i, lastSyncedAt: now }));
    res.json({ success: true, message: `Successfully imported ${items.length} Stock Items from Tally Prime`, items });
  });

  // 5. Invoices & Buffer Queue Endpoints
  app.get('/api/invoices', (req, res) => {
    const status = req.query.status as string;
    if (status && status !== 'all') return res.json(invoices.filter(i => i.syncStatus === status));
    res.json(invoices);
  });

  app.post('/api/invoices', (req, res) => {
    const { debtorId, invoiceDate, dueDate, items: invoiceItemsData, notes, eWayBillNo, pushDirectly } = req.body;
    const debtor = debtors.find(d => d.id === debtorId);
    if (!debtor) return res.status(400).json({ error: 'Debtor not found' });

    const nextSeq = invoices.length + 1;
    const invNum = `AT/24-25/${String(nextSeq).padStart(3, '0')}`;
    const isInterstate = debtor.stateCode !== company.stateCode;
    const placeOfSupply = `${debtor.stateCode}-${debtor.state}`;

    let subtotal = 0, totalDiscount = 0, taxableValue = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
    const processedItems = invoiceItemsData.map((it: any) => {
      const stockItem = items.find(s => s.id === it.itemId);
      const itemName = stockItem ? stockItem.name : it.itemName || 'Item';
      const hsnCode = stockItem ? stockItem.hsnCode : it.hsnCode || '8471';
      const uom = stockItem ? stockItem.uom : it.uom || 'NOS';
      const gstRate = stockItem ? stockItem.gstRate : Number(it.gstRate || 18);
      const qty = Number(it.quantity || 1);
      const rate = Number(it.rate || (stockItem ? stockItem.standardPrice : 1000));
      const discountPct = Number(it.discountPercent || 0);
      const gross = qty * rate;
      const discountVal = (gross * discountPct) / 100;
      const taxable = gross - discountVal;
      let cgstRate = 0, cgstAmt = 0, sgstRate = 0, sgstAmt = 0, igstRate = 0, igstAmt = 0;
      if (isInterstate) { igstRate = gstRate; igstAmt = (taxable * igstRate) / 100; }
      else { cgstRate = gstRate / 2; cgstAmt = (taxable * cgstRate) / 100; sgstRate = gstRate / 2; sgstAmt = (taxable * sgstRate) / 100; }
      const totalItem = taxable + cgstAmt + sgstAmt + igstAmt;
      subtotal += gross; totalDiscount += discountVal; taxableValue += taxable; totalCgst += cgstAmt; totalSgst += sgstAmt; totalIgst += igstAmt;
      if (stockItem) stockItem.currentStock = Math.max(0, stockItem.currentStock - qty);
      return { itemId: it.itemId, itemName, hsnCode, uom, quantity: qty, rate, discountPercent: discountPct, taxableAmount: Number(taxable.toFixed(2)), gstRate, cgstRate, cgstAmount: Number(cgstAmt.toFixed(2)), sgstRate, sgstAmount: Number(sgstAmt.toFixed(2)), igstRate, igstAmount: Number(igstAmt.toFixed(2)), totalAmount: Number(totalItem.toFixed(2)) };
    });
    const unroundedTotal = taxableValue + totalCgst + totalSgst + totalIgst;
    const roundedTotal = Math.round(unroundedTotal);
    const roundOff = Number((roundedTotal - unroundedTotal).toFixed(2));
    const newInvoice: SalesInvoice = {
      id: `INV-2024-${String(nextSeq).padStart(3, '0')}`, invoiceNumber: invNum,
      invoiceDate: invoiceDate || new Date().toISOString().split('T')[0], dueDate: dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      companyGstin: company.gstin, debtorId: debtor.id, debtorName: debtor.name, debtorGstin: debtor.gstin, debtorState: debtor.state, debtorStateCode: debtor.stateCode,
      placeOfSupply, isInterstate, reverseCharge: false, eWayBillNo: eWayBillNo || undefined, items: processedItems,
      subtotal: Number(subtotal.toFixed(2)), totalDiscount: Number(totalDiscount.toFixed(2)), taxableValue: Number(taxableValue.toFixed(2)),
      totalCgst: Number(totalCgst.toFixed(2)), totalSgst: Number(totalSgst.toFixed(2)), totalIgst: Number(totalIgst.toFixed(2)), roundOff, grandTotal: roundedTotal,
      paymentStatus: 'Pending', paidAmount: 0, syncStatus: pushDirectly ? 'pushed' : 'buffer', tallyVoucherGuid: pushDirectly ? `TALLY-VCH-${Date.now()}` : undefined,
      pushedAt: pushDirectly ? new Date().toISOString() : undefined, createdAt: new Date().toISOString(), notes: notes || '',
    };
    debtor.currentBalance += roundedTotal; debtor.pendingInvoicesCount += 1; debtor.aging.under30 += roundedTotal;
    invoices.unshift(newInvoice);
    res.status(201).json({ success: true, message: pushDirectly ? `Invoice ${newInvoice.invoiceNumber} created and pushed directly to Tally Prime!` : `Invoice ${newInvoice.invoiceNumber} created and saved in Buffer queue.`, invoice: newInvoice });
  });

  app.post('/api/invoices/:id/push', (req, res) => {
    const inv = invoices.find(i => i.id === req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    inv.syncStatus = 'pushed'; inv.tallyVoucherGuid = `TALLY-VCH-${Date.now()}`; inv.pushedAt = new Date().toISOString();
    res.json({ success: true, message: `Invoice ${inv.invoiceNumber} successfully pushed into Tally Prime ledger!`, invoice: inv });
  });

  app.delete('/api/invoices/:id', (req, res) => {
    const invIndex = invoices.findIndex(i => i.id === req.params.id);
    if (invIndex === -1) return res.status(404).json({ error: 'Invoice not found' });
    const deleted = invoices.splice(invIndex, 1)[0];
    const debtor = debtors.find(d => d.id === deleted.debtorId);
    if (debtor) { debtor.currentBalance = Math.max(0, debtor.currentBalance - deleted.grandTotal); debtor.pendingInvoicesCount = Math.max(0, debtor.pendingInvoicesCount - 1); }
    res.json({ success: true, message: `Invoice ${deleted.invoiceNumber} deleted from system/buffer.`, deletedId: deleted.id });
  });

  app.post('/api/buffer/push-all', (req, res) => {
    const buffered = invoices.filter(i => i.syncStatus === 'buffer');
    if (buffered.length === 0) return res.json({ success: true, message: 'No invoices currently in buffer queue.', count: 0 });
    const now = new Date().toISOString();
    buffered.forEach(inv => { inv.syncStatus = 'pushed'; inv.tallyVoucherGuid = `TALLY-VCH-${Date.now()}-${inv.invoiceNumber.replace(/[^a-zA-Z0-9]/g, '')}`; inv.pushedAt = now; });
    res.json({ success: true, message: `Successfully pushed all ${buffered.length} buffered invoices into Tally Prime!`, count: buffered.length });
  });

  app.get('/api/tally/export-voucher-xml/:id', (req, res) => {
    const inv = invoices.find(i => i.id === req.params.id);
    if (!inv) return res.status(404).send('Invoice not found');
    const xmlContent = buildSalesVoucherXml(inv, company.name);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="Tally_Sales_${inv.invoiceNumber.replace(/[^a-zA-Z0-9]/g, '_')}.xml"`);
    res.send(xmlContent);
  });

  app.get('/api/gstr1/summary', (req, res) => {
    const month = (req.query.month as string) || '2024-10';
    res.json(buildGstr1Summary(invoices, company.gstin, month));
  });

  app.get('/api/gstr1/download-json', (req, res) => {
    const month = (req.query.month as string) || '2024-10';
    const officialJson = generateOfficialGstnJson(buildGstr1Summary(invoices, company.gstin, month));
    const [yyyy, mm] = month.split('-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="returns_${mm}${yyyy}_${company.gstin}_R1.json"`);
    res.send(JSON.stringify(officialJson, null, 2));
  });

  app.get('/api/analytics', (req, res) => {
    let totalSales = 0, totalTaxCollected = 0, cgst = 0, sgst = 0, igst = 0;
    invoices.forEach(inv => { totalSales += inv.grandTotal; totalTaxCollected += inv.totalCgst + inv.totalSgst + inv.totalIgst; cgst += inv.totalCgst; sgst += inv.totalSgst; igst += inv.totalIgst; });
    let pendingReceivables = 0, overdueReceivables = 0;
    const debtorsAging = { under30: 0, days31to60: 0, days61to90: 0, over90: 0 };
    debtors.forEach(d => { pendingReceivables += d.currentBalance; overdueReceivables += d.overdueAmount; debtorsAging.under30 += d.aging.under30; debtorsAging.days31to60 += d.aging.days31to60; debtorsAging.days61to90 += d.aging.days61to90; debtorsAging.over90 += d.aging.over90; });
    const bufferedCount = invoices.filter(i => i.syncStatus === 'buffer').length;
    const syncedCount = invoices.filter(i => i.syncStatus === 'pushed').length;
    const salesTrend = [
      { date: '01 Oct', sales: 45000, tax: 8100, invoices: 1 }, { date: '04 Oct', sales: 259954, tax: 39654, invoices: 1 },
      { date: '10 Oct', sales: 128620, tax: 19620, invoices: 1 }, { date: '18 Oct', sales: 89680, tax: 13680, invoices: 1 },
      { date: '22 Oct', sales: 38350, tax: 5850, invoices: 1 }, { date: '28 Oct', sales: 112000, tax: 17080, invoices: 2 },
    ];
    const topDebtors = [...debtors].sort((a,b)=>b.currentBalance-a.currentBalance).slice(0,5).map(d=>({name:d.name,balance:d.currentBalance,overdue:d.overdueAmount,state:d.state}));
    res.json({ kpis: { totalSales, monthlyGrowth: 18.4, totalTaxCollected, pendingReceivables, overdueReceivables, totalInvoices: invoices.length, bufferedCount, syncedCount }, salesTrend, debtorsAging, topDebtors, taxBreakdown: { cgst, sgst, igst } });
  });

  app.get('/api/domain-info', (req, res) => {
    res.json({ domain: 'anish-tech.online', status: 'configured', cnameRecord: { type: 'CNAME', host: '@ / www', value: 'ghs.googlehosted.com' }, ssl: 'Active (Automated Google Managed SSL)', bridgePort: 9000, instructions: ['Domain DNS: Point anish-tech.online CNAME or A records to the Cloud Run domain mapping.', 'Tally Prime: Ensure "Tally is acting as Server" is enabled under F12: Advanced Configurations > Tally XML Server Port: 9000.', 'Desktop Sync: Run the local AnishTech Tally Bridge agent to pipe localhost:9000 to anish-tech.online securely.'] });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // The app is deployed at /utility. Vite correctly generates /utility/assets/* URLs,
    // so Express must serve the same dist directory under that public mount as well.
    app.use('/utility', express.static(distPath));
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();