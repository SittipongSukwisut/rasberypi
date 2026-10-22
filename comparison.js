/* QR / Measurement comparison; shares configuration and parsing with script.js */
(() => {
  const el = id => document.getElementById(id);
  const get = (o, keys) => firstValue(o, keys, null);
  const valid = v => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== '-';
  const norm = v => valid(v) ? String(v).trim().toUpperCase() : '';
  const num = v => valid(v) && Number.isFinite(Number(v)) ? Number(v) : null;
  const safe = v => escapeHtml(String(v ?? '—'));
  let results = [];
  function qrInfo(r) {
    const p = parseQRData(getQRRaw(r));
    return {
      id: norm(get(r,['id','uuid'])),
      code: norm(get(r,['product_code','productCode'])) || norm(p.productCode),
      lot: norm(get(r,['lot','lot_number','production_lot'])) || norm(p.lot),
      count: num(get(r,['quantity','sheet_count','expected_count','qty'])) ?? num(p.quantity),
      raw: getQRRaw(r), date: get(r,['created_at','scanned_at','date'])
    };
  }
  function measurementInfo(r) {
    return {
      qrId: norm(get(r,['qr_record_id','qr_id'])),
      code: norm(get(r,['product_code','productCode'])),
      lot: norm(get(r,['lot','lot_number','production_lot'])),
      raw: getQRRaw(r), count: num(getActualCount(r)), date: getMeasuredDate(r)
    };
  }
  function linkQR(m, qr) {
    if (m.qrId) return qr.find(q => q.id === m.qrId) || null;
    if (m.raw) return qr.find(q => q.raw && q.raw === m.raw) || null;
    // Avoid ambiguous product-only matches: require LOT and unique candidate.
    if (m.code && m.lot) {
      const matches = qr.filter(q => q.code === m.code && q.lot === m.lot);
      return matches.length === 1 ? matches[0] : null;
    }
    return null;
  }
  function display() {
    const term = norm(el('compareSearch').value), filter = el('compareFilter').value;
    const filtered = results.filter(r => (filter === 'all' || filter === r.status) &&
      (!term || [r.code,r.lot,r.raw].some(v => norm(v).includes(term))));
    el('compareRows').innerHTML = filtered.length ? filtered.map(r => {
      const label = r.status === 'pass' ? 'ตรงกัน' : r.status === 'fail' ? 'ไม่ตรงกัน' : 'จับคู่ไม่ได้';
      const delta = r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta}`;
      const date = r.date ? formatDate(r.date) : '—';
      return `<tr><td><b>${safe(r.code || 'ไม่พบรหัสสินค้า')}</b><small>LOT: ${safe(r.lot || '—')}</small></td>
      <td>${r.expected === null ? '—' : safe(r.expected)+' แผ่น'}</td>
      <td>${r.actual === null ? '—' : safe(r.actual)+' แผ่น'}</td>
      <td class="compare-diff">${safe(delta)}</td><td><span class="compare-pill ${r.status}">${label}</span></td><td>${safe(date)}</td></tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;padding:28px">ไม่พบรายการที่ตรงกับเงื่อนไข</td></tr>';
  }
  async function load() {
    el('compareNotice').textContent = 'กำลังโหลดข้อมูลจาก Supabase…';
    try {
      const [q,m] = await Promise.all([
        supabaseClient.from(QR_TABLE).select('*').limit(1000),
        supabaseClient.from(MEASUREMENT_TABLE).select('*').limit(1000)
      ]);
      if(q.error) throw new Error('qr_records: '+q.error.message);
      if(m.error) throw new Error('wood_measurements: '+m.error.message);
      const qr = (q.data || []).map(qrInfo);
      results = (m.data || []).map(record => {
        const meas = measurementInfo(record), match = linkQR(meas,qr);
        const expected = match?.count ?? null, actual = meas.count;
        const delta = expected !== null && actual !== null ? actual - expected : null;
        return { code:meas.code || match?.code || '', lot:meas.lot || match?.lot || '', raw:meas.raw || match?.raw || '',
          expected,actual,delta,date:meas.date,status:delta === null?'unmatched':delta === 0?'pass':'fail' };
      });
      el('statMatched').textContent = results.filter(r => r.delta !== null).length;
      el('statPass').textContent = results.filter(r => r.status === 'pass').length;
      el('statFail').textContent = results.filter(r => r.status === 'fail').length;
      el('statUnmatched').textContent = results.filter(r => r.status === 'unmatched').length;
      el('compareNotice').textContent = `โหลดข้อมูลแล้ว: QR ${qr.length} รายการ และผลการวัด ${results.length} รายการ (สูงสุด 1,000 รายการต่อตาราง)`;
      display();
    } catch(err) {
      el('compareNotice').textContent = 'โหลดข้อมูลไม่สำเร็จ: '+readableSupabaseError(err);
      el('compareRows').innerHTML = '';
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    el('compareRefresh').addEventListener('click',load);
    el('compareSearch').addEventListener('input',display);
    el('compareFilter').addEventListener('change',display);
    load();
  });
})();
