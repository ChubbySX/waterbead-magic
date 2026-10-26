/* 2号波组装助手 · 规则引擎
 * 独立模块：浏览器中挂载 window.V2Engine，Node 中 module.exports。
 * 输入：PARTS_DB（data.js 提供）+ selection（用户装配选择）。
 * selection 结构：{ [partId]: { brand, product, qty, notes, attrs: {属性:值} } }
 * attrs 为可选覆盖；未覆盖时取零件 defaults。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.V2Engine = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function db() { return (typeof window !== 'undefined' && window.PARTS_DB) ? window.PARTS_DB : global.__PARTS_DB__; }
  function getPart(id) { return db().parts.find(function (p) { return p.id === id; }); }

  function isSelected(sel, id) { return !!(sel && sel[id] && sel[id].selected); }

  function resolveAttr(part, sel, attr) {
    var s = sel && sel[part.id];
    if (s && s.attrs && s.attrs[attr] !== undefined && s.attrs[attr] !== '') return s.attrs[attr];
    if (part.defaults && part.defaults[attr] !== undefined) return part.defaults[attr];
    var def = part.attrs && part.attrs[attr];
    if (def && def.values && def.values.length) return def.values[0];
    return undefined;
  }

  function inList(v, list) {
    if (list === undefined) return false;
    return (Array.isArray(list) ? list : [list]).indexOf(v) >= 0;
  }

  function matchConditions(conds, sel) {
    if (!conds || !conds.length) return true;
    return conds.every(function (c) {
      if (!isSelected(sel, c.part)) return false;
      var p = getPart(c.part);
      if (!p) return false;
      var v = resolveAttr(p, sel, c.attr);
      return inList(v, c.value);
    });
  }

  function item(rule, status, msg, fix) {
    return { id: rule.id, name: rule.name, level: status, msg: msg || rule.msg, fix: rule.fix || '' };
  }

  function runChecks(sel) {
    var out = [];
    db().rules.forEach(function (rule) {
      switch (rule.type) {
        case 'attr_chain': {
          var anchor = getPart(rule.anchor);
          if (!anchor || !isSelected(sel, rule.anchor)) return;
          var av = resolveAttr(anchor, sel, rule.attr);
          (rule.chain || []).forEach(function (cid) {
            if (!isSelected(sel, cid)) return;
            var cp = getPart(cid);
            if (!cp) return;
            var cv = resolveAttr(cp, sel, rule.attr);
            if (cv !== av) {
              out.push(item(rule, 'warn', cp.name + '（' + rule.attr + '=' + cv + '）与 ' + anchor.name + '（' + rule.attr + '=' + av + '）不一致。' + rule.msg, rule.fix));
            }
          });
          if (rule.addWhenValue !== undefined && av === rule.addWhenValue) {
            (rule.add || []).forEach(function (aid) {
              if (!isSelected(sel, aid)) {
                var ap = getPart(aid);
                out.push(item(rule, 'warn', '缺少回膛配套件：' + (ap ? ap.name : aid) + '。' + rule.msg, rule.fix));
              }
            });
          }
          break;
        }
        case 'presence_advice': {
          if (!matchConditions(rule.when, sel)) return;
          if (!isSelected(sel, rule.suggest)) {
            var sp = getPart(rule.suggest);
            out.push(item(rule, rule.level || 'info', (sp ? sp.name : rule.suggest) + ' 建议一并选配：' + rule.msg, rule.fix));
          }
          break;
        }
        case 'attr_pair': {
          if (!matchConditions(rule.when, sel)) return;
          var baseMsg = rule.msg;
          var hasBad = false;
          (rule.then || []).forEach(function (t) {
            if (t.part && !t.attr && t.reason) {
              // 建议项：始终展示为提示
              out.push(item(rule, 'info', '建议：' + t.reason, ''));
              return;
            }
            if (t.part && t.attr) {
              var tp = getPart(t.part);
              if (!tp || !isSelected(sel, t.part)) return;
              var tv = resolveAttr(tp, sel, t.attr);
              var matched = inList(tv, t.value);
              if (t.status === 'bad' && matched) { hasBad = true; }
              if (t.status === 'good') {
                if (matched) out.push(item(rule, 'info', '满足：' + tp.name + '（' + t.attr + '=' + tv + '）' + (t.reason ? ' · ' + t.reason : ''), ''));
                else if (t.reason) out.push(item(rule, 'info', '建议：' + t.reason, ''));
              }
            }
          });
          if (hasBad) { out.push(item(rule, 'warn', baseMsg, rule.fix)); }
          else if (rule.then && rule.then.some(function (t) { return t.status === 'bad'; })) {
            out.push(item(rule, 'info', baseMsg, rule.fix));
          } else if (!rule.then || !rule.then.length) {
            // 纯条件型规则（仅有 when 无 then）：命中即按规则级别输出
            if (rule.level === 'warn') out.push(item(rule, 'warn', baseMsg, rule.fix));
            else out.push(item(rule, 'info', baseMsg, rule.fix));
          }
          break;
        }
        case 'exclusive_group': {
          var picked = (rule.parts || []).filter(function (id) { return isSelected(sel, id); });
          if (picked.length > 1) {
            out.push(item(rule, 'warn', '同时选配了 ' + picked.map(function (id) { var p = getPart(id); return p ? p.name : id; }).join('、') + '。' + rule.msg, rule.fix));
          }
          break;
        }
        case 'requires': {
          var missing = (rule.parts || []).filter(function (id) { return !isSelected(sel, id); });
          if (missing.length) {
            out.push(item(rule, 'warn', '缺少：' + missing.map(function (id) { var p = getPart(id); return p ? p.name : id; }).join('、') + '。' + rule.msg, rule.fix));
          } else {
            out.push(item(rule, 'ok', rule.msg + '（已齐备）', ''));
          }
          break;
        }
        case 'any_required': {
          var pickedAny = (rule.parts || []).some(function (id) { return isSelected(sel, id); });
          if (!pickedAny) {
            out.push(item(rule, 'warn', '须三选一：' + (rule.parts || []).map(function (id) { var p = getPart(id); return p ? p.name : id; }).join(' / ') + '。' + rule.msg, rule.fix));
          } else {
            out.push(item(rule, 'ok', rule.msg + '（已选配）', ''));
          }
          break;
        }
        case 'or_group': {
          (rule.groups || []).forEach(function (g) {
            if (isSelected(sel, g.part)) {
              out.push(item(rule, rule.level || 'warn', g.msg || rule.msg, rule.fix));
            }
          });
          break;
        }
        case 'always': {
          out.push(item(rule, rule.level || 'info', rule.msg, rule.fix));
          break;
        }
        default: break;
      }
    });
    return out;
  }

  function groupStats(sel) {
    var stats = {};
    db().groups.forEach(function (g) {
      var parts = db().parts.filter(function (p) { return p.group === g.id; });
      var selected = parts.filter(function (p) { return isSelected(sel, p.id); });
      var mandatory = parts.filter(function (p) { return !p.optional; });
      var mandatorySelected = mandatory.filter(function (p) { return isSelected(sel, p.id); });
      stats[g.id] = {
        name: g.name, seq: g.seq, desc: g.desc, mandatory: g.mandatory,
        total: parts.length, selected: selected.length,
        mandatoryCount: mandatory.length, mandatorySelected: mandatorySelected.length,
        complete: mandatory.every(function (p) { return isSelected(sel, p.id); })
      };
    });
    return stats;
  }

  function applyPreset(scenarioId) {
    var sc = db().scenarios.find(function (s) { return s.id === scenarioId; });
    if (!sc) return null;
    return selectionFromPreset(sc.preset);
  }

  function applyBasegun(basegunId, productName) {
    var bg = db().baseguns && db().baseguns.find(function (b) { return b.id === basegunId; });
    if (!bg) return null;
    if (productName && (bg.products || []).indexOf(productName) < 0) return null;
    var sel = selectionFromPreset(bg.preset);
    var generation = productName && productName.match(/[-–]([1-4])\.\d+$/);
    if (generation && bg.generationPresets && bg.generationPresets[generation[1]]) {
      Object.assign(sel, selectionFromPreset(bg.generationPresets[generation[1]]));
    }
    if (productName && bg.productPresets && bg.productPresets[productName]) {
      var pp = bg.productPresets[productName];
      Object.keys(pp).forEach(function (pid) {
        sel[pid] = { selected: true, brand: pp[pid].brand || '', product: pp[pid].product || '', qty: 1, notes: '', attrs: Object.assign({}, pp[pid].attrs || {}) };
      });
    }
    return sel;
  }

  function selectionFromPreset(preset) {
    var sel = {};
    Object.keys(preset || {}).forEach(function (pid) {
      var c = preset[pid];
      sel[pid] = { selected: true, brand: c.brand || '', product: c.product || '', qty: 1, notes: '', attrs: Object.assign({}, c.attrs || {}) };
    });
    return sel;
  }

  function partLookup(id) { return getPart(id); }
  function defaultSelection() { return {}; }

  return {
    getPart: partLookup,
    isSelected: isSelected,
    resolveAttr: resolveAttr,
    runChecks: runChecks,
    groupStats: groupStats,
    applyPreset: applyPreset,
    applyBasegun: applyBasegun,
    defaultSelection: defaultSelection
  };
});
