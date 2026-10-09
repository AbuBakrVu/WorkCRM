// Генерация документов по шаблонам Word (метки в стиле Битрикс24) и УПД в XML (формат ФНС 5.03)
import JSZip from 'jszip';
import iconv from 'iconv-lite';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

/* ---------- числа, суммы, даты ---------- */
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export function money(n) {
  const [i, f] = r2(n || 0).toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${f}`;
}
const qty = (n) => (Number.isInteger(Number(n)) ? String(n) : String(r2(n)).replace('.', ','));

const ONES = [['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
function triad(n, fem) {
  const out = [];
  out.push(HUNDREDS[Math.floor(n / 100)]);
  const t = n % 100;
  if (t >= 10 && t < 20) out.push(TEENS[t - 10]);
  else { out.push(TENS[Math.floor(t / 10)]); out.push(ONES[fem ? 1 : 0][t % 10]); }
  return out.filter(Boolean).join(' ');
}
const SCALES = [null, ['тысяча', 'тысячи', 'тысяч', true], ['миллион', 'миллиона', 'миллионов', false], ['миллиард', 'миллиарда', 'миллиардов', false]];
export function numberWords(n) {
  n = Math.floor(n);
  if (n === 0) return 'ноль';
  const parts = [];
  for (let s = 0; n > 0; s++, n = Math.floor(n / 1000)) {
    const t = n % 1000;
    if (!t) continue;
    const sc = SCALES[s];
    parts.unshift(sc ? `${triad(t, sc[3])} ${plural(t, sc[0], sc[1], sc[2])}` : triad(t, false));
  }
  return parts.join(' ');
}
// «Двенадцать тысяч триста сорок пять рублей 60 копеек»
export function amountWords(sum) {
  const v = r2(sum || 0);
  const rub = Math.floor(v); const kop = Math.round((v - rub) * 100);
  const s = `${numberWords(rub)} ${plural(rub, 'рубль', 'рубля', 'рублей')} ${String(kop).padStart(2, '0')} ${plural(kop, 'копейка', 'копейки', 'копеек')}`;
  return s[0].toUpperCase() + s.slice(1);
}
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const pad = (n) => String(n).padStart(2, '0');
// Дата 'YYYY-MM-DD' → «9 октября 2026 г.» или по формату вида d.m.y (y/Y — год полностью)
function fmtDate(s, format) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!format) return `${d} ${MONTHS_GEN[m - 1]} ${y} г.`;
  return format.replace(/[dDjmnMFyY]/g, (c) => ({ d: pad(d), j: d, D: pad(d), m: pad(m), n: m, M: MONTHS_GEN[m - 1], F: MONTHS_GEN[m - 1], y, Y: y })[c]);
}
// «Иванов Иван Иванович» → по шаблону #LAST_NAME# #NAME_SHORT# #SECOND_NAME_SHORT#
function fioFormat(full, format) {
  const [last = '', name = '', second = ''] = String(full || '').trim().split(/\s+/);
  return format.replace(/#LAST_NAME#/g, last).replace(/#NAME#/g, name).replace(/#SECOND_NAME#/g, second)
    .replace(/#NAME_SHORT#/g, name ? `${name[0]}.` : '').replace(/#SECOND_NAME_SHORT#/g, second ? `${second[0]}.` : '').replace(/\s+/g, ' ').trim();
}

/* ---------- XML-помощники ---------- */
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Метки, разбитые Word на несколько фрагментов (<w:t>), склеиваем в один фрагмент внутри абзаца
function mergeSplitTags(xml) {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => {
    const re = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;
    const nodes = []; let m;
    while ((m = re.exec(p))) nodes.push({ start: m.index, end: m.index + m[0].length, open: m[1], text: unesc(m[2]) });
    if (nodes.length < 2) return p;
    const full = nodes.map((n) => n.text).join('');
    if (!full.includes('{')) return p;
    // Для каждого символа — номер узла; метки, разорванные между узлами, целиком переносим в первый узел
    const owner = []; nodes.forEach((n, i) => { for (let k = 0; k < n.text.length; k++) owner.push(i); });
    const span = new Array(full.length).fill(null); // символ внутри разорванной метки → { start, tag }
    const tagRe = /\{[^{}]*\}/g; let t; let changed = false;
    while ((t = tagRe.exec(full))) {
      if (owner[t.index] === owner[t.index + t[0].length - 1]) continue;
      changed = true;
      for (let c = t.index; c < t.index + t[0].length; c++) span[c] = { start: t.index, tag: t[0] };
    }
    if (!changed) return p;
    const texts = nodes.map(() => '');
    for (let c = 0; c < full.length; c++) {
      const sp = span[c];
      if (!sp) texts[owner[c]] += full[c];
      else if (c === sp.start) texts[owner[c]] += sp.tag;
    }
    let out = ''; let last = 0;
    nodes.forEach((n, i) => {
      out += p.slice(last, n.start);
      const txt = texts[i];
      const open = n.open.includes('xml:space') ? n.open : n.open.replace('<w:t', '<w:t xml:space="preserve"');
      out += `${open}${esc(txt)}</w:t>`;
      last = n.end;
    });
    return out + p.slice(last);
  });
}

// Разбор метки: {Name~mod1=v,mod2} → { name, mods }
function parseTag(raw) {
  const inner = raw.slice(1, -1).trim();
  const [name, modStr = ''] = inner.split('~');
  const mods = {};
  if (modStr) {
    if (/^Format=/.test(modStr)) mods.Format = modStr.slice(7);
    else for (const part of modStr.split(',')) { const [k, v] = part.split('=').map((x) => x.trim()); if (v === undefined) mods._fmt = k; else mods[k] = v; }
  }
  return { name: name.trim(), mods };
}
function formatValue(val, mods, kind) {
  if (val == null) return '';
  if (mods.Format && kind === 'person') return fioFormat(val, mods.Format);
  if (kind === 'date') return fmtDate(val, mods._fmt);
  if (kind === 'money' || typeof val === 'number') {
    if (mods.W === 'Y') return amountWords(val);
    return kind === 'money' ? money(val) : qty(val);
  }
  return String(val);
}

/* ---------- данные документа → метки Битрикс24 ---------- */
// ctx: { doc: {number, date, period}, company, client, owner, items: [{name, unit, qty, price, vat_rate, net, vat, total}], totals: {net, vat, total}, vatMode }
export function buildFields(ctx) {
  const { company: co = {}, client: cl = {}, owner = {}, doc = {}, totals = {}, vatMode = 'above' } = ctx;
  const [ownerLast = '', ownerName = ''] = String(owner.name || '').split(/\s+/);
  const hasVat = totals.vat > 0;
  const rates = [...new Set((ctx.items || []).filter((i) => i.vat_rate && i.vat_rate !== 'none').map((i) => i.vat_rate))];
  const totalRaw = vatMode === 'included' ? totals.total : totals.net;
  const F = {
    DocumentNumber: [doc.number], DocumentCreateTime: [doc.date, 'date'], DocumentTitle: [doc.title],
    MyCompanyName: [co.name], MyCompanyPhone: [co.phone], MyCompanyEmail: [co.email], MyCompanyWeb: [co.site],
    MyCompanyRequisiteRqCompanyName: [co.full_name || co.name], MyCompanyRequisiteRqCompanyFullName: [co.full_name || co.name],
    MyCompanyRequisiteRqInn: [co.inn], MyCompanyRequisiteRqKpp: [co.kpp], MyCompanyRequisiteRqOgrn: [co.ogrn], MyCompanyRequisiteRqOgrnip: [co.ogrn],
    MyCompanyRequisiteRegisteredAddressText: [co.address], MyCompanyRequisiteRqDirector: [co.director_name, 'person'], MyCompanyRequisiteRqAccountant: [co.accountant_name, 'person'],
    MyCompanyBankDetailRqBankName: [co.bank_name], MyCompanyBankDetailRqBik: [co.bik], MyCompanyBankDetailRqAccNum: [co.account], MyCompanyBankDetailRqCorAccNum: [co.corr_account],
    MyCompanyAssignedName: [ownerName], MyCompanyAssignedLastName: [ownerLast], MyCompanyAssignedFullName: [owner.name], MyCompanyAssignedWorkPosition: [owner.position],
    MyCompanyAssignedPersonalMobile: [owner.phone], MyCompanyAssignedEmail: [owner.email], MyCompanyAssignedPhone: [owner.phone],
    ClientName: [cl.name], ClientPhone: [cl.phone], ClientEmail: [cl.email], ClientWeb: [cl.site], ClientContactName: [cl.contact_name],
    RequisiteRqCompanyName: [cl.full_name || cl.name], RequisiteRqCompanyFullName: [cl.full_name || cl.name], RequisiteRqInn: [cl.inn], RequisiteRqKpp: [cl.kpp], RequisiteRqOgrn: [cl.ogrn],
    RequisiteRegisteredAddressText: [cl.address], RequisiteRqDirector: [cl.director_name, 'person'],
    BankDetailRqBankName: [cl.bank_name], BankDetailRqBik: [cl.bik], BankDetailRqAccNum: [cl.account], BankDetailRqCorAccNum: [cl.corr_account],
    TotalRaw: [totalRaw, 'money'], TotalSum: [totals.total, 'money'], TotalSumWords: [amountWords(totals.total)], TotalTax: [totals.vat, 'money'],
    TotalWithoutTax: [totals.net, 'money'], TaxesTaxTitle: [vatMode === 'included' && hasVat ? 'В т.ч. НДС' : 'НДС'], TaxesTaxValue: [totals.vat, 'money'],
    TaxesTaxRatePct: [hasVat && rates.length === 1 ? ` ${rates[0]}%` : ''], TaxesTaxRate: [hasVat && rates.length === 1 ? rates[0] : ''],
    // поле «период» (в Битрикс24 — пользовательское поле сделки)
    UfCrm1738502330: [doc.period], Period: [doc.period], ContractNumber: [doc.contract_no], ContractDate: [doc.contract_date, 'date'],
  };
  return F;
}
const rowFields = (it, i) => ({
  ProductsIndex: [i + 1], ProductsProductName: [it.name], ProductsProductQuantity: [it.qty], ProductsProductMeasureName: [it.unit],
  ProductsProductPriceRaw: [it.price, 'money'], ProductsProductPriceRawSum: [r2(it.qty * it.price), 'money'], ProductsProductPrice: [it.price, 'money'],
  ProductsProductPriceSum: [it.total, 'money'], ProductsProductTaxRate: [it.vat_rate && it.vat_rate !== 'none' ? `${it.vat_rate}%` : 'без НДС'],
  ProductsProductTaxValue: [it.vat, 'money'], ProductsProductPriceNetto: [r2(it.net / it.qty), 'money'], ProductsProductPriceNettoSum: [it.net, 'money'],
});

function substitute(xml, fields) {
  return xml.replace(/\{[A-Za-z][^{}<>]*\}/g, (raw) => {
    const { name, mods } = parseTag(raw);
    if (!(name in fields)) return raw;
    const [val, kind] = fields[name];
    return esc(formatValue(val, mods, kind));
  });
}

// Строки таблицы с метками {Products…} повторяем для каждой позиции
function expandRows(xml, items) {
  return xml.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (tr) => {
    if (!/\{Products/.test(tr)) return tr;
    return items.map((it, i) => substitute(tr, rowFields(it, i))).join('');
  });
}

// НДС: в шаблонах «без НДС» стоит текст «Без НДС» — если НДС есть, подставляем сумму и ставку
function fixVatTexts(xml, totals, vatMode, rate) {
  if (!(totals.vat > 0)) return xml;
  const label = vatMode === 'included' ? `В т.ч. НДС${rate ? ` ${rate}%` : ''}:` : `НДС${rate ? ` ${rate}%` : ''}:`;
  return xml
    .replace(/(<w:t[^>]*>)\s*Без НДС\s*(<\/w:t>)/g, `$1${money(totals.vat)}$2`)
    .replace(/,\s*без НДС\.?/g, `, в т.ч. НДС ${money(totals.vat)} руб.`)
    .replace(/(<w:t[^>]*>)\s*НДС:\s*(<\/w:t>)/g, `$1${label}$2`);
}

/* ---------- картинки-метки: {MyCompanyUfStamp}, {MyCompanyUfDirectorSign}, {PaymentQrCode} ---------- */
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), ext: 'jpeg' };
      i += 2 + len;
    }
    return { w: 1, h: 1, ext: 'jpeg' };
  }
  return null;
}
async function replaceImages(zip, xmlPath, xml, images) {
  const relsPath = xmlPath.replace(/word\/([^/]+)$/, 'word/_rels/$1.rels');
  let rels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : null;
  let ct = await zip.file('[Content_Types].xml').async('string');
  let n = 0;
  xml = xml.replace(/<w:r>(?:(?!<w:r>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:r>|<w:drawing>[\s\S]*?<\/w:drawing>/g, (block) => {
    const name = (block.match(/<wp:docPr [^>]*name="(\{[^"]+\})"/) || [])[1];
    if (!name) return block;
    const key = parseTag(name).name;
    const img = images[key];
    if (!img || !rels) return ''; // картинки нет (или «без подписи и печати») — убираем заглушку
    const size = imageSize(img);
    if (!size) return '';
    const id = `rIdCrm${++n}${key}`;
    const target = `media/crm_${key}_${n}.${size.ext}`;
    zip.file(`word/${target}`, img);
    rels = rels.replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`);
    if (!new RegExp(`Extension="${size.ext}"`, 'i').test(ct)) ct = ct.replace('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">', `$&<Default Extension="${size.ext}" ContentType="image/${size.ext}"/>`);
    // ширина как у заглушки, высота — по пропорциям картинки
    return block.replace(/r:embed="[^"]*"/, `r:embed="${id}"`).replace(/(<wp:extent cx=")(\d+)(" cy=")(\d+)(")|(<a:ext cx=")(\d+)(" cy=")(\d+)(")/g, (m0, a1, cx1, a3, cy1, a5, b1, cx2, b3, cy2, b5) => {
      const cx = Number(cx1 || cx2); const boxCy = Number(cy1 || cy2);
      let w = cx, h = Math.round((cx * size.h) / size.w);
      if (h > boxCy * 1.6) { h = Math.round(boxCy * 1.6); w = Math.round((h * size.w) / size.h); } // не растягиваем слишком высокие подписи
      return a1 ? `${a1}${w}${a3}${h}${a5}` : `${b1}${w}${b3}${h}${b5}`;
    });
  });
  if (rels) zip.file(relsPath, rels);
  zip.file('[Content_Types].xml', ct);
  return xml;
}

// QR-код для оплаты (ГОСТ Р 56042-2014): банковские приложения заполняют платёж по нему
export async function paymentQr(co, sum, purpose) {
  if (!co?.account || !co?.bik) return null;
  const clean = (s) => String(s || '').replace(/\|/g, ' ');
  const s = ['ST00012', `Name=${clean(co.full_name || co.name)}`, `PersonalAcc=${co.account}`, `BankName=${clean(co.bank_name)}`, `BIC=${co.bik}`,
    `CorrespAcc=${co.corr_account || '0'}`, `PayeeINN=${co.inn || ''}`, `KPP=${co.kpp || ''}`, `Purpose=${clean(purpose)}`, `Sum=${Math.round(r2(sum) * 100)}`].join('|');
  return QRCode.toBuffer(s, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 360 });
}

/* ---------- основной рендер ---------- */
export async function renderDocx(template, ctx, images = {}) {
  const zip = await JSZip.loadAsync(template);
  const parts = Object.keys(zip.files).filter((p) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(p));
  const fields = buildFields(ctx);
  for (const p of parts) {
    let xml = await zip.file(p).async('string');
    xml = mergeSplitTags(xml);
    xml = xml.replace(/ ?\{TaxesTaxRate\}%/g, '{TaxesTaxRatePct}');
    xml = expandRows(xml, ctx.items || []);
    xml = await replaceImages(zip, p, xml, images);
    xml = substitute(xml, fields);
    xml = fixVatTexts(xml, ctx.totals || {}, ctx.vatMode, fields.TaxesTaxRate[0]);
    // пустые реквизиты: «…, ИНН , КПП , , тел.: » → без пустых кусков
    xml = xml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (m, a, t, c) => a + t.replace(/,\s*(ИНН|КПП|ОГРН)\s*(?=,|$)/g, '').replace(/(,\s*){2,}/g, ', ').replace(/,\s*тел\.:\s*$/, '') + c);
    xml = xml.replace(/\{(?:Products|MyCompany|Requisite|BankDetail|Client|Document|Total|Taxes|Uf|Payment)[^{}<>]*\}/g, ''); // неизвестные метки — пустые
    zip.file(p, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Метки, которые есть в шаблоне (для проверки при загрузке)
export async function templateTags(template) {
  const zip = await JSZip.loadAsync(template);
  const tags = new Set();
  for (const p of Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f))) {
    const xml = mergeSplitTags(await zip.file(p).async('string'));
    for (const m of xml.matchAll(/\{([A-Za-z][^{}<>~]*)(?:~[^{}<>]*)?\}/g)) tags.add(m[1].trim());
  }
  const known = new Set([...Object.keys(buildFields({ totals: {} })), ...Object.keys(rowFields({ qty: 1, price: 0, net: 0 }, 0)), 'MyCompanyUfStamp', 'MyCompanyUfDirectorSign', 'PaymentQrCode', 'MyCompanyLogo']);
  return { tags: [...tags], unknown: [...tags].filter((t) => !known.has(t)) };
}

// DOCX → PDF через LibreOffice (в Docker-образе он установлен)
export function docxToPdf(buf) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crmdoc-'));
    const src = path.join(dir, 'doc.docx');
    fs.writeFileSync(src, buf);
    const bin = process.env.SOFFICE_BIN || 'soffice';
    execFile(bin, ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/profile`, '--convert-to', 'pdf', '--outdir', dir, src], { timeout: 90000 }, (err) => {
      try {
        const out = path.join(dir, 'doc.pdf');
        if (err || !fs.existsSync(out)) return reject(new Error(err?.code === 'ENOENT' ? 'PDF недоступен: на сервере не установлен LibreOffice' : 'Не удалось сделать PDF'));
        resolve(fs.readFileSync(out));
      } finally { setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 1000); }
    });
  });
}

/* ---------- УПД: XML по формату ФНС 5.03 (приказ ЕД-7-26/970@) ---------- */
const OKEI = { шт: ['796', 'шт'], 'шт.': ['796', 'шт'], усл: ['876', 'усл. ед'], 'усл.': ['876', 'усл. ед'], ч: ['356', 'ч'], час: ['356', 'ч'], мес: ['362', 'мес'], компл: ['839', 'компл'],
  м: ['006', 'м'], упак: ['778', 'упак'], кг: ['166', 'кг'], л: ['112', 'л'], лиц: ['796', 'шт'], 'м2': ['055', 'м2'], пог: ['018', 'пог. м'] };
const dmy = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
const isIp = (p) => String(p.inn || '').replace(/\D/g, '').length === 12;
function party(p) {
  const inn = String(p.inn || '').replace(/\D/g, '');
  let id;
  if (isIp(p)) {
    const [f = '', i = '', o = ''] = String(p.director_name || p.full_name || p.name || '').replace(/^ИП\s+/i, '').trim().split(/\s+/);
    id = `<СвИП${attrs({ ИННФЛ: inn })}><ФИО${attrs({ Фамилия: f, Имя: i || '-', Отчество: o })}/></СвИП>`;
  } else id = `<СвЮЛУч${attrs({ НаимОрг: p.full_name || p.name, ИННЮЛ: inn, КПП: p.kpp })}/>`;
  const addr = p.address ? `<Адрес><АдрИнф КодСтр="643" НаимСтран="Россия"${attrs({ АдрТекст: p.address })}/></Адрес>` : '';
  return `<ИдСв>${id}</ИдСв>${addr}`;
}
// ctx как для renderDocx + doc.basis (договор), doc.content («Услуги оказаны»)
export function buildUpd(ctx) {
  const { company: co, client: cl, doc, items, totals } = ctx;
  const withVat = items.some((i) => i.vat_rate && i.vat_rate !== 'none');
  const func = withVat ? 'СЧФДОП' : 'ДОП';
  const naim = withVat ? 'Счет-фактура и документ об отгрузке товаров (выполнении работ), передаче имущественных прав (документ об оказании услуг)'
    : 'Документ об отгрузке товаров (выполнении работ), передаче имущественных прав (документ об оказании услуг)';
  const now = new Date(Date.now() + 3 * 3600e3);
  const today = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, '.');
  const idFile = `ON_NSCHFDOPPR_${cl.edo_id || '0'}_${co.edo_id || '0'}_${today.replace(/-/g, '')}_${crypto.randomUUID()}_0_0_0_0_0_00`;
  const rows = items.map((it, i) => {
    const [okei, unit] = OKEI[String(it.unit || '').trim().toLowerCase()] || ['796', it.unit || 'шт'];
    const rate = it.vat_rate && it.vat_rate !== 'none' ? `${it.vat_rate}%` : 'без НДС';
    const vat = rate === 'без НДС' ? '<СумНал><БезНДС>без НДС</БезНДС></СумНал>' : `<СумНал><СумНал>${r2(it.vat).toFixed(2)}</СумНал></СумНал>`;
    return `<СведТов${attrs({ НомСтр: i + 1, НаимТов: it.name, ОКЕИ_Тов: okei, НаимЕдИзм: unit, КолТов: r2(it.qty), ЦенаТов: r2(it.net / it.qty).toFixed(2),
      СтТовБезНДС: r2(it.net).toFixed(2), НалСт: rate, СтТовУчНал: r2(it.total).toFixed(2) })}><Акциз><БезАкциз>без акциза</БезАкциз></Акциз>${vat}</СведТов>`;
  }).join('');
  const totalVat = withVat ? `<СумНалВсего><СумНал>${r2(totals.vat).toFixed(2)}</СумНал></СумНалВсего>` : '<СумНалВсего><БезНДС>без НДС</БезНДС></СумНалВсего>';
  const [sf = '', si = '', so = ''] = String(co.director_name || '').trim().split(/\s+/);
  const basis = doc.contract_no
    ? `<ОснПер${attrs({ РеквНаимДок: 'Договор', РеквНомерДок: doc.contract_no, РеквДатаДок: doc.contract_date ? dmy(doc.contract_date) : dmy(doc.date) })}/>`
    : '<БезДокОснПер>1</БезДокОснПер>';
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<Файл${attrs({ ИдФайл: idFile, ВерсФорм: '5.03', ВерсПрог: 'CRM 1.0' })}>
<Документ${attrs({ КНД: '1115131', Функция: func, ПоФактХЖ: 'Документ об отгрузке товаров (выполнении работ), передаче имущественных прав (документ об оказании услуг)',
    НаимДокОпр: naim, ДатаИнфПр: dmy(today), ВремИнфПр: time, НаимЭконСубСост: `${co.full_name || co.name}${co.inn ? `, ИНН ${co.inn}` : ''}` })}>
<СвСчФакт${attrs({ НомерДок: doc.number, ДатаДок: dmy(doc.date) })}>
<СвПрод>${party(co)}</СвПрод>
<ДокПодтвОтгрНом${attrs({ РеквНаимДок: 'Универсальный передаточный документ', РеквНомерДок: doc.number, РеквДатаДок: dmy(doc.date) })}/>
<СвПокуп>${party(cl)}</СвПокуп>
<ДенИзм КодОКВ="643" НаимОКВ="Российский рубль"/>
</СвСчФакт>
<ТаблСчФакт>${rows}<ВсегоОпл${attrs({ СтТовБезНДСВсего: r2(totals.net).toFixed(2), СтТовУчНалВсего: r2(totals.total).toFixed(2) })}>${totalVat}</ВсегоОпл></ТаблСчФакт>
<СвПродПер><СвПер${attrs({ СодОпер: doc.content || 'Услуги оказаны, работы выполнены', ДатаПер: dmy(doc.date) })}>${basis}</СвПер></СвПродПер>
<Подписант${attrs({ СпосПодтПолном: '1', Должн: co.director_title || (isIp(co) ? 'Индивидуальный предприниматель' : 'Генеральный директор') })}><ФИО${attrs({ Фамилия: sf || '-', Имя: si || '-', Отчество: so })}/></Подписант>
</Документ>
</Файл>`;
  return { name: `${idFile}.xml`, buffer: iconv.encode(xml, 'win1251') };
}
