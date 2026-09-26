/** 采集规则管理页：规则的增删改、启停、排序，全部存 chrome.storage.local（key: rules） */
import { RULE_DEFS } from './rules-lib.js';

const $ = (id) => document.getElementById(id);
const RULES_KEY = 'rules';
let rules = [];
let editingId = null; // null = 新增

async function load() {
  const s = await chrome.storage.local.get([RULES_KEY]);
  rules = Array.isArray(s[RULES_KEY]) ? s[RULES_KEY] : [];
  rules.sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
}

function save() {
  return chrome.storage.local.set({ [RULES_KEY]: rules });
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 规则条件的文字摘要（显示在列表里） */
function condSummary(rule) {
  const parts = [];
  if (rule.brand === 'none') parts.push('仅无品牌');
  else if (rule.brand === 'custom' && rule.brandText) parts.push(`品牌含「${rule.brandText}」`);
  if (rule.salesSchema) parts.push(rule.salesSchema);
  const conds = rule.conds || {};
  for (const def of RULE_DEFS) {
    const c = conds[def.key];
    if (!c) continue;
    const hasMin = c.min !== '' && c.min != null;
    const hasMax = c.max !== '' && c.max != null;
    if (hasMin && hasMax) parts.push(`${def.label} ${c.min}~${c.max}`);
    else if (hasMin) parts.push(`${def.label} ≥ ${c.min}`);
    else if (hasMax) parts.push(`${def.label} ≤ ${c.max}`);
  }
  return parts.length ? parts.join(' · ') : '无条件（命中全部商品）';
}

function render() {
  const box = $('list');
  if (!rules.length) {
    box.innerHTML = '<div class="empty">还没有规则，点右上角「新增规则」创建第一条</div>';
    return;
  }
  box.innerHTML = rules
    .map(
      (r, i) => `
    <div class="rule-item ${r.enabled === false ? 'disabled' : ''}">
      <label class="switch" title="启用/停用">
        <input type="checkbox" data-toggle="${i}" ${r.enabled === false ? '' : 'checked'} /><i></i>
      </label>
      <span class="tag-chip" style="background:${escapeHtml(r.color || '#1677ff')}">${escapeHtml(r.tag || '')}</span>
      <span class="rule-name">${escapeHtml(r.name || '未命名')}</span>
      <span class="rule-meta">优先级 ${Number(r.priority) || 0} · ${escapeHtml(condSummary(r))}</span>
      <button data-edit="${i}">编辑</button>
      <button class="danger" data-del="${i}">删除</button>
    </div>`,
    )
    .join('');
}

/* ─────────────── 编辑弹窗 ─────────────── */

function buildCondRows(conds) {
  $('conds').innerHTML = RULE_DEFS.map(
    (d) => `
    <div class="cond">
      <span>${d.label}</span>
      <input type="text" data-cond="${d.key}" data-side="min" placeholder="最小值" value="${conds && conds[d.key] ? escapeHtml(conds[d.key].min ?? '') : ''}" />
      <b>至</b>
      <input type="text" data-cond="${d.key}" data-side="max" placeholder="最大值" value="${conds && conds[d.key] ? escapeHtml(conds[d.key].max ?? '') : ''}" />
    </div>`,
  ).join('');
}

function openModal(rule) {
  editingId = rule ? rule.id : null;
  $('modalTitle').textContent = rule ? '编辑规则' : '新增规则';
  $('f_name').value = rule ? rule.name || '' : '';
  $('f_tag').value = rule ? rule.tag || '' : '';
  $('f_priority').value = rule ? Number(rule.priority) || 0 : 0;
  const color = rule && rule.color ? rule.color : '#1677ff';
  $('f_color').value = color;
  $('f_colorPick').value = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#1677ff';
  $('f_brand').value = rule ? rule.brand || 'any' : 'any';
  $('f_brandText').value = rule ? rule.brandText || '' : '';
  $('brandTextField').style.display = $('f_brand').value === 'custom' ? '' : 'none';
  $('f_salesSchema').value = rule ? rule.salesSchema || '' : '';
  buildCondRows(rule ? rule.conds : null);
  $('formErr').textContent = '';
  $('modalMask').classList.add('show');
}

function closeModal() {
  $('modalMask').classList.remove('show');
  editingId = null;
}

function collectForm() {
  const conds = {};
  document.querySelectorAll('[data-cond]').forEach((inp) => {
    const v = inp.value.trim();
    if (v === '' || isNaN(Number(v))) return; // 留空 / 非数字 = 不限制
    const k = inp.getAttribute('data-cond');
    const side = inp.getAttribute('data-side');
    (conds[k] = conds[k] || {})[side] = Number(v);
  });
  return {
    id: editingId || `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: $('f_name').value.trim(),
    tag: $('f_tag').value.trim(),
    priority: Number($('f_priority').value) || 0,
    color: /^#[0-9a-fA-F]{6}$/.test($('f_color').value.trim()) ? $('f_color').value.trim() : '#1677ff',
    brand: $('f_brand').value,
    brandText: $('f_brandText').value.trim(),
    salesSchema: $('f_salesSchema').value,
    conds,
    enabled: true,
  };
}

/* ─────────────── 事件 ─────────────── */

$('add').onclick = () => openModal(null);

$('cancel').onclick = closeModal;

$('modalMask').addEventListener('click', (e) => {
  if (e.target === $('modalMask')) closeModal();
});

$('f_colorPick').addEventListener('input', () => {
  $('f_color').value = $('f_colorPick').value;
});
$('f_color').addEventListener('input', () => {
  const v = $('f_color').value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) $('f_colorPick').value = v;
});
$('f_brand').addEventListener('change', () => {
  $('brandTextField').style.display = $('f_brand').value === 'custom' ? '' : 'none';
});

$('save').onclick = async () => {
  const r = collectForm();
  if (!r.name) { $('formErr').textContent = '请填写规则名称'; return; }
  if (!r.tag) { $('formErr').textContent = '请填写标签名称'; return; }
  const idx = rules.findIndex((x) => x.id === r.id);
  if (idx >= 0) rules[idx] = { ...rules[idx], ...r };
  else rules.push(r);
  rules.sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0));
  await save();
  closeModal();
  render();
};

$('list').addEventListener('click', async (e) => {
  const t = e.target.closest('button,input');
  if (!t) return;
  if (t.hasAttribute('data-del')) {
    const i = Number(t.getAttribute('data-del'));
    const r = rules[i];
    if (confirm(`确定删除规则「${r.name || '未命名'}」？`)) {
      rules.splice(i, 1);
      await save();
      render();
    }
  } else if (t.hasAttribute('data-edit')) {
    openModal(rules[Number(t.getAttribute('data-edit'))]);
  }
});

$('list').addEventListener('change', async (e) => {
  const t = e.target;
  if (t.hasAttribute && t.hasAttribute('data-toggle')) {
    const i = Number(t.getAttribute('data-toggle'));
    rules[i].enabled = t.checked;
    await save();
    render();
  }
});

(async () => {
  await load();
  render();
})();
