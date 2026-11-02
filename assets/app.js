/* ==========================================================
   Portal de Estágio UniVC — lógica do front-end
   ========================================================== */
(function () {
  "use strict";

  var CONFIG = window.PORTAL_CONFIG || {};
  var API_URL = (CONFIG.APPS_SCRIPT_URL || "").trim();
  var DEMO = !API_URL;
  var DRAFT_KEY = "univc-estagio-rascunho-v1";

  // 17 cursos de graduação presencial da UniVC, agrupados por área.
  // Para alterar a lista, edite aqui (e em CURSOS no Code.gs).
  var COURSES = [
    { area: "Saúde", items: ["Educação Física", "Enfermagem", "Farmácia", "Fisioterapia", "Medicina Veterinária", "Odontologia", "Psicologia"] },
    { area: "Engenharias, Tecnologia e Agrárias", items: ["Agronomia", "Análise e Desenvolvimento de Sistemas", "Arquitetura e Urbanismo", "Engenharia Civil", "Engenharia de Produção", "Engenharia Mecânica"] },
    { area: "Ciências Sociais Aplicadas", items: ["Administração", "Ciências Contábeis", "Direito", "Publicidade e Propaganda"] },
  ];

  var UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------- utilidades ---------------- */
  function onlyDigits(s) { return String(s || "").replace(/\D/g, ""); }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function storage(fn) { try { return fn(window.localStorage); } catch (e) { return null; } }

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function isValidCPF(v) {
    var c = onlyDigits(v);
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (var t = 9; t < 11; t++) {
      var sum = 0;
      for (var i = 0; i < t; i++) sum += Number(c[i]) * (t + 1 - i);
      var d = ((sum * 10) % 11) % 10;
      if (d !== Number(c[t])) return false;
    }
    return true;
  }

  function isValidCNPJ(v) {
    var c = onlyDigits(v);
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    var calc = function (len) {
      var sum = 0, pos = len - 7;
      for (var i = len; i >= 1; i--) {
        sum += Number(c[len - i]) * pos--;
        if (pos < 2) pos = 9;
      }
      var r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
  }

  var MASKS = {
    cpf: function (d) { return d.slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); },
    cnpj: function (d) { return d.slice(0, 14).replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2"); },
    phone: function (d) {
      d = d.slice(0, 11);
      if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
      return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
    },
  };

  function bindMasks(root) {
    $$("[data-mask]", root).forEach(function (el) {
      el.addEventListener("input", function () {
        el.value = MASKS[el.dataset.mask](onlyDigits(el.value));
      });
    });
  }

  /* ---------------- API (Apps Script) ---------------- */
  function api(action, data) {
    if (DEMO) return demoApi(action, data);
    // text/plain evita o preflight CORS; o Apps Script lê e.postData.contents
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: action, data: data }),
      redirect: "follow",
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function demoApi(action, data) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (action === "checkLink") {
          var p = detectProvider(data.url);
          resolve(p.ok
            ? { ok: true, status: "publico", provider: p.provider, message: "Formato válido (simulado — sem servidor configurado)." }
            : { ok: true, status: "invalido", message: p.message });
        } else if (action === "submit") {
          resolve({ ok: true, protocolo: "EST-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0") });
        } else if (action === "submitReport") {
          resolve({ ok: true, message: "Relatório registrado (simulado)." });
        } else {
          resolve({ ok: false, error: "Ação desconhecida." });
        }
      }, 700);
    });
  }

  /* ---------------- detecção e validação de links ---------------- */
  function detectProvider(raw) {
    var value = String(raw || "").trim();
    if (!value) return { ok: false, message: "Cole um link." };
    var u;
    try { u = new URL(value); } catch (e) { return { ok: false, message: "Isso não parece um link. Copie o endereço completo, começando com https://" }; }
    if (u.protocol !== "https:") return { ok: false, message: "O link precisa começar com https://" };
    var host = u.hostname.toLowerCase();

    if (host === "drive.google.com" || host === "docs.google.com") {
      if (/^\/drive\/(u\/\d+\/)?(my-drive|home|recent|shared-with-me|starred)/.test(u.pathname)) {
        return { ok: false, message: "Esse é o link da sua página do Drive, não do arquivo. Use “Compartilhar › Copiar link” no próprio arquivo." };
      }
      var hasId = /\/d\/[\w-]{10,}/.test(u.pathname) || /\/folders\/[\w-]{10,}/.test(u.pathname) || /^[\w-]{10,}$/.test(u.searchParams.get("id") || "");
      if (!hasId) return { ok: false, message: "Não encontramos o identificador do arquivo nesse link do Google. Copie novamente pelo botão “Copiar link”." };
      return { ok: true, provider: "google" };
    }
    if (host === "1drv.ms" || host === "onedrive.live.com" || host.endsWith(".onedrive.live.com") || host === "onedrive.com" || host.endsWith(".sharepoint.com")) {
      return { ok: true, provider: "microsoft" };
    }
    return { ok: false, message: "Aceitamos apenas links do Google Drive/Docs ou do OneDrive/SharePoint." };
  }

  var FIX_TIPS = {
    google: [
      "Abra o arquivo no Google Drive e clique em <strong>Compartilhar</strong>.",
      "Em <strong>Acesso geral</strong>, troque “Restrito” por <strong>“Qualquer pessoa com o link”</strong>.",
      "Clique em <strong>Copiar link</strong>, cole aqui de novo e verifique.",
    ],
    microsoft: [
      "No OneDrive, selecione o arquivo e clique em <strong>Compartilhar › configurações do link</strong>.",
      "Escolha <strong>“Qualquer pessoa”</strong>, sem senha e sem data de expiração.",
      "Clique em <strong>Copiar link</strong>, cole aqui de novo e verifique.",
    ],
  };

  function LinkField(root) {
    this.root = root;
    this.input = $("[data-link-input]", root);
    this.btn = $("[data-link-check]", root);
    this.statusEl = $("[data-link-status]", root);
    this.badge = $("[data-link-badge]", root);
    this.required = root.hasAttribute("data-required");
    this.name = root.dataset.name || "";
    this.state = "idle"; // idle | checking | publico | privado | invalido | nao_encontrado | indeterminado
    this.result = null;
    this.checkedUrl = "";
    this.pending = null;

    var self = this;
    this.btn.addEventListener("click", function () { self.check(); });
    this.input.addEventListener("input", function () {
      if (self.input.value.trim() !== self.checkedUrl) self.reset();
      self.input.classList.remove("is-invalid");
    });
    this.input.addEventListener("paste", function () { setTimeout(function () { self.check(); }, 50); });
    this.input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); self.check(); } });
    this.input.addEventListener("blur", function () {
      if (self.input.value.trim() && self.state === "idle") self.check();
    });
  }

  LinkField.prototype.value = function () { return this.input.value.trim(); };

  LinkField.prototype.reset = function () {
    this.state = "idle";
    this.result = null;
    this.checkedUrl = "";
    this.statusEl.innerHTML = "";
    this.root.classList.remove("is-ok", "is-bad");
    if (this.badge) { this.badge.className = "doc-badge"; this.badge.textContent = this.required ? "Pendente" : "Opcional"; }
  };

  LinkField.prototype.render = function () {
    var r = this.result || {};
    var html = "", cls = "", badgeText = "", badgeCls = "";
    var provider = r.provider || (detectProvider(this.value()).provider);
    switch (this.state) {
      case "checking":
        html = '<div class="ls ls-wait"><span class="spinner" aria-hidden="true"></span><span>Abrindo o link como visitante sem login…</span></div>';
        badgeText = "Verificando…";
        break;
      case "publico":
        html = '<div class="ls ls-ok"><span class="ls-ico">✓</span><span><strong>Link público — tudo certo.</strong>' +
          (r.title ? "Arquivo encontrado: <em>" + escapeHtml(r.title) + "</em>. " : "") +
          escapeHtml(r.message || "") + "</span></div>";
        cls = "is-ok"; badgeText = "✓ Público"; badgeCls = "ok";
        break;
      case "privado":
        html = '<div class="ls ls-bad"><span class="ls-ico">✗</span><span><strong>Esse link está privado.</strong>' +
          "Ao abrir sem login, o " + (provider === "microsoft" ? "OneDrive" : "Google") + " pediu para entrar na conta. Para corrigir:" +
          '<ol class="ls-fix">' + (FIX_TIPS[provider] || FIX_TIPS.google).map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ol></span></div>";
        cls = "is-bad"; badgeText = "✗ Privado"; badgeCls = "bad";
        break;
      case "nao_encontrado":
        html = '<div class="ls ls-bad"><span class="ls-ico">✗</span><span><strong>Arquivo não encontrado ou sem acesso público.</strong>O link pode estar incompleto, o arquivo pode ter sido apagado ou ainda estar restrito. Confira o compartilhamento e copie o link de novo.</span></div>';
        cls = "is-bad"; badgeText = "✗ Não encontrado"; badgeCls = "bad";
        break;
      case "invalido":
        html = '<div class="ls ls-bad"><span class="ls-ico">✗</span><span><strong>Link inválido.</strong>' + escapeHtml(r.message || "") + "</span></div>";
        cls = "is-bad"; badgeText = "✗ Inválido"; badgeCls = "bad";
        break;
      case "indeterminado":
        html = '<div class="ls ls-warn"><span class="ls-ico">!</span><span><strong>Não conseguimos confirmar.</strong>' +
          escapeHtml(r.message || "O serviço não respondeu. Tente verificar novamente em instantes.") + "</span></div>";
        cls = "is-bad"; badgeText = "! Tente de novo"; badgeCls = "bad";
        break;
      default:
        this.reset();
        return;
    }
    this.statusEl.innerHTML = html;
    this.root.classList.remove("is-ok", "is-bad");
    if (cls) this.root.classList.add(cls);
    if (this.badge) { this.badge.className = "doc-badge" + (badgeCls ? " " + badgeCls : ""); this.badge.textContent = badgeText; }
  };

  LinkField.prototype.check = function () {
    var self = this;
    var url = this.value();
    if (!url) { this.reset(); return Promise.resolve(false); }
    if (this.pending && this.checkedUrl === url) return this.pending;

    var p = detectProvider(url);
    if (!p.ok) {
      this.state = "invalido"; this.result = { message: p.message }; this.checkedUrl = url;
      this.render();
      return Promise.resolve(false);
    }
    this.state = "checking"; this.checkedUrl = url;
    this.btn.disabled = true;
    this.render();

    this.pending = api("checkLink", { url: url }).then(function (res) {
      if (self.value() !== url) return false; // usuário mudou o link no meio
      self.result = res || {};
      self.state = res && res.status ? res.status : "indeterminado";
      if (res && res.ok === false) { self.state = "indeterminado"; self.result = { message: res.error }; }
      self.render();
      return self.state === "publico";
    }).catch(function () {
      if (self.value() !== url) return false;
      self.state = "indeterminado";
      self.result = { message: "Falha de conexão com o servidor do portal. Verifique sua internet e tente de novo." };
      self.render();
      return false;
    }).then(function (ok) {
      self.btn.disabled = false;
      self.pending = null;
      return ok;
    });
    return this.pending;
  };

  LinkField.prototype.isOk = function () { return this.state === "publico" && this.checkedUrl === this.value(); };

  var linkFields = $$("[data-link-field]").map(function (el) { var f = new LinkField(el); el._lf = f; return f; });
  function fieldsIn(root) { return linkFields.filter(function (f) { return root.contains(f.root); }); }

  /* ---------------- cursos e UFs ---------------- */
  function renderCourses() {
    var grid = $("#courseGrid");
    grid.innerHTML = COURSES.map(function (g) {
      return '<div class="course-group"><div class="course-group-title">' + escapeHtml(g.area) + '</div><div class="course-grid-inner">' +
        g.items.map(function (c) {
          return '<label class="course"><input type="radio" name="curso" value="' + escapeHtml(c) + '" required><span class="course-radio" aria-hidden="true"></span><span>' + escapeHtml(c) + "</span></label>";
        }).join("") + "</div></div>";
    }).join("");
  }

  function renderUFs() {
    var sel = $("#uf");
    UFS.forEach(function (uf) {
      var o = document.createElement("option");
      o.value = uf; o.textContent = uf;
      sel.appendChild(o);
    });
    sel.value = "ES";
  }

  /* ---------------- wizard ---------------- */
  var form = $("#wizard");
  var steps = $$(".step", form);
  var stepperItems = $$("#stepper li");
  var current = 1;
  var TOTAL = steps.length;

  function setError(name, msg) {
    var el = $('[data-error-for="' + name + '"]', form) || $('[data-error-for="' + name + '"]');
    if (el) el.textContent = msg || "";
  }

  function markInvalid(el, msg) {
    el.classList.add("is-invalid");
    el.setAttribute("aria-invalid", "true");
    var errId = el.id ? el.id + "-err" : null;
    if (errId && msg) {
      var err = document.getElementById(errId);
      if (!err) {
        err = document.createElement("div");
        err.className = "field-error"; err.id = errId;
        el.insertAdjacentElement("afterend", err);
        el.setAttribute("aria-describedby", errId);
      }
      err.textContent = msg;
    }
  }

  function clearInvalid(el) {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
    var err = el.id && document.getElementById(el.id + "-err");
    if (err) err.textContent = "";
  }

  form.addEventListener("input", function (e) {
    if (e.target.classList.contains("is-invalid")) clearInvalid(e.target);
    if (e.target.type === "radio") {
      setError(e.target.name, "");
      var group = e.target.closest(".seg, .course-grid");
      if (group) group.classList.remove("is-invalid");
    }
    saveDraft();
  });

  function validateStep(n) {
    var stepEl = steps[n - 1];
    var firstBad = null;
    var bad = function (el) { if (!firstBad) firstBad = el; };

    // campos comuns
    $$("input:not([type=radio]):not([type=checkbox]):not([data-link-input]), select, textarea", stepEl).forEach(function (el) {
      clearInvalid(el);
      var v = el.value.trim();
      if (el.required && !v) { markInvalid(el, "Campo obrigatório."); bad(el); return; }
      if (!v) return;
      if (el.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { markInvalid(el, "E-mail inválido."); bad(el); }
      if (el.dataset.mask === "cpf" && !isValidCPF(v)) { markInvalid(el, "CPF inválido."); bad(el); }
      if (el.dataset.mask === "cnpj" && !isValidCNPJ(v)) { markInvalid(el, "CNPJ inválido."); bad(el); }
      if (el.dataset.mask === "phone" && onlyDigits(v).length < 10) { markInvalid(el, "Telefone incompleto."); bad(el); }
    });

    // grupos de rádio
    var radioNames = {};
    $$("input[type=radio][required]", stepEl).forEach(function (r) { radioNames[r.name] = true; });
    Object.keys(radioNames).forEach(function (name) {
      var checked = $('input[name="' + name + '"]:checked', stepEl);
      var group = $('input[name="' + name + '"]', stepEl).closest(".seg, .course-grid");
      if (!checked) {
        setError(name, name === "curso" ? "Selecione o seu curso." : "Selecione uma opção.");
        if (group) group.classList.add("is-invalid");
        bad($('input[name="' + name + '"]', stepEl));
      }
    });

    // regras específicas
    if (n === 3) {
      var ini = $("#dataInicio").value, fim = $("#termino").value;
      if (ini && fim && fim < ini) { markInvalid($("#termino"), "A data de término deve ser depois do início."); bad($("#termino")); }
      var hs = Number($("#horasSemanais").value);
      if (hs > 40) { markInvalid($("#horasSemanais"), "Máximo de 40 h/semana."); bad($("#horasSemanais")); }
    }
    if (n === 5) {
      if (!$("#lgpd").checked) { setError("lgpd", "É preciso aceitar para enviar."); bad($("#lgpd")); }
      else setError("lgpd", "");
    }

    if (firstBad) {
      firstBad.focus({ preventScroll: true });
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  // Na etapa de documentos, todos os obrigatórios precisam estar públicos e
  // os opcionais preenchidos também precisam passar.
  function validateLinks(root) {
    var fields = fieldsIn(root);
    var checks = fields.map(function (f) {
      if (!f.value()) {
        if (f.required) { f.input.classList.add("is-invalid"); return Promise.resolve(false); }
        return Promise.resolve(true);
      }
      return f.isOk() ? Promise.resolve(true) : f.check();
    });
    return Promise.all(checks).then(function (oks) {
      var badIdx = oks.indexOf(false);
      if (badIdx >= 0) {
        fields[badIdx].root.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }
      return true;
    });
  }

  function showStep(n) {
    current = n;
    steps.forEach(function (s, i) { s.hidden = i !== n - 1; });
    stepperItems.forEach(function (li, i) {
      li.classList.toggle("is-current", i === n - 1);
      li.classList.toggle("is-done", i < n - 1);
      if (i === n - 1) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    $("#btnBack").hidden = n === 1;
    $("#btnNext").hidden = n === TOTAL;
    $("#btnSubmit").hidden = n !== TOTAL;
    $("#stepCount").textContent = "Etapa " + n + " de " + TOTAL;
    $("#formError").hidden = true;
    if (n === 4) {
      // verifica automaticamente links restaurados do rascunho
      fieldsIn(steps[3]).forEach(function (f) { if (f.value() && f.state === "idle") f.check(); });
    }
    if (n === TOTAL) buildReview();
    var top = $("#cadastro").getBoundingClientRect().top + window.scrollY - 80;
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: "smooth" });
  }

  $("#btnNext").addEventListener("click", function () {
    var btn = this;
    if (!validateStep(current)) return;
    if (current === 4) {
      btn.disabled = true;
      validateLinks(steps[3]).then(function (ok) {
        btn.disabled = false;
        if (ok) showStep(current + 1);
        else showFormError("Há documentos pendentes. Todos os links obrigatórios precisam estar como “✓ Público”.");
      });
      return;
    }
    showStep(current + 1);
  });

  $("#btnBack").addEventListener("click", function () { showStep(current - 1); });

  function showFormError(msg) {
    var el = $("#formError");
    el.textContent = msg;
    el.hidden = false;
  }

  function collect() {
    var fd = new FormData(form);
    var data = {};
    fd.forEach(function (v, k) { data[k] = typeof v === "string" ? v.trim() : v; });
    data.lgpd = $("#lgpd").checked;
    return data;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso;
  }

  function buildReview() {
    var d = collect();
    var linkLabel = function (name) {
      var f = linkFields.filter(function (x) { return x.name === name; })[0];
      if (!f || !f.value()) return "<em>não informado</em>";
      return '<span class="pill pill-ok pill-sm">✓ Público</span> <a href="' + escapeHtml(f.value()) + '" target="_blank" rel="noopener">abrir</a>';
    };
    var block = function (title, step, rows) {
      return '<div class="review-block"><h4>' + title + ' <button type="button" data-goto="' + step + '">Editar</button></h4><dl>' +
        rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + (r[2] ? r[1] : escapeHtml(r[1] || "—")) + "</dd>"; }).join("") + "</dl></div>";
    };
    $("#review").innerHTML =
      block("Dados pessoais", 1, [
        ["Nome", d.nome], ["CPF", d.cpf], ["Matrícula", d.matricula], ["Nascimento", fmtDate(d.nascimento)],
        ["Celular", d.telefone], ["E-mail", d.email], ["Curso", d.curso], ["Turno / período", (d.turno || "") + " · " + (d.periodo || "")],
      ]) +
      block("Empresa", 2, [
        ["Empresa", d.empresa], ["CNPJ", d.cnpj], ["Endereço", d.endereco + " — " + d.cidade + "/" + d.uf],
        ["Supervisor(a)", d.supervisor + " (" + d.supervisorCargo + ")"], ["Contato supervisor", d.supervisorEmail + (d.supervisorTelefone ? " · " + d.supervisorTelefone : "")],
      ]) +
      block("Estágio", 3, [
        ["Tipo / modalidade", d.tipo + " · " + d.modalidade], ["Período", fmtDate(d.inicio) + " a " + fmtDate(d.termino)],
        ["Carga horária", d.horasSemanais + " h/semana · " + d.cargaTotal + " h no total"], ["Orientador(a)", d.orientador], ["Atividades", d.atividades],
      ]) +
      block("Documentos", 4, [
        ["Termo de Compromisso", linkLabel("linkTce"), true],
        ["Plano de Atividades", linkLabel("linkPlano"), true],
        ["Apólice de seguro", linkLabel("linkSeguro"), true],
      ]);
    $$("[data-goto]", $("#review")).forEach(function (b) {
      b.addEventListener("click", function () { showStep(Number(b.dataset.goto)); });
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (current !== TOTAL || !validateStep(TOTAL)) return;
    var btn = $("#btnSubmit");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    $("#formError").hidden = true;

    api("submit", collect()).then(function (res) {
      if (!res || !res.ok) {
        var msg = (res && res.error) || "Não foi possível enviar.";
        if (res && res.links) {
          // servidor reverificou e encontrou link não público
          Object.keys(res.links).forEach(function (name) {
            var f = linkFields.filter(function (x) { return x.name === name; })[0];
            if (f) { f.state = res.links[name].status; f.result = res.links[name]; f.render(); }
          });
        }
        throw new Error(msg);
      }
      $("#protocolValue").textContent = res.protocolo;
      form.hidden = true;
      $("#stepper").hidden = true;
      $("#success").hidden = false;
      $("#success").focus();
      storage(function (s) { s.removeItem(DRAFT_KEY); });
      $("#rProtocolo").value = res.protocolo;
      $("#rCpf").value = collect().cpf;
    }).catch(function (err) {
      showFormError(err.message + " Se o problema continuar, fale com " + (CONFIG.CONTATO_EMAIL || "a Coordenação de Estágios") + ".");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Enviar cadastro";
    });
  });

  $("#copyProtocol").addEventListener("click", function () {
    var text = $("#protocolValue").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { toast("Protocolo copiado."); },
      function () { toast("Anote o protocolo: " + text); }
    );
  });

  $("#newRegistration").addEventListener("click", function () {
    form.reset();
    linkFields.forEach(function (f) { if (form.contains(f.root)) f.reset(); });
    renderUFs();
    form.hidden = false;
    $("#stepper").hidden = false;
    $("#success").hidden = true;
    showStep(1);
  });

  /* ---------------- rascunho ---------------- */
  var draftTimer;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      var d = collect();
      delete d.lgpd;
      storage(function (s) { s.setItem(DRAFT_KEY, JSON.stringify(d)); });
    }, 400);
  }

  function restoreDraft() {
    var raw = storage(function (s) { return s.getItem(DRAFT_KEY); });
    if (!raw) return;
    var d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    Object.keys(d).forEach(function (k) {
      var els = form.elements[k];
      if (!els) return;
      if (els.length && els[0] && els[0].type === "radio") {
        $$('input[name="' + k + '"]', form).forEach(function (r) { r.checked = r.value === d[k]; });
      } else if (els.value !== undefined) {
        els.value = d[k];
      }
    });
    toast("Recuperamos o rascunho do seu cadastro.");
  }

  /* ---------------- CNPJ: preenchimento automático ---------------- */
  function bindCnpjLookup() {
    var input = $("#cnpj"), hint = $("#cnpjHint");
    var last = "";
    input.addEventListener("input", function () {
      var c = onlyDigits(input.value);
      if (c.length !== 14 || c === last) return;
      last = c;
      if (!isValidCNPJ(c)) { hint.textContent = "CNPJ inválido — confira os números."; return; }
      hint.textContent = "Buscando dados da empresa…";
      fetch("https://brasilapi.com.br/api/cnpj/v1/" + c).then(function (r) {
        if (!r.ok) throw new Error();
        return r.json();
      }).then(function (j) {
        var fill = function (id, v) { var el = $("#" + id); if (v && !el.value.trim()) el.value = v; };
        fill("empresa", j.razao_social || j.nome_fantasia);
        fill("endereco", [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" ") + (j.numero ? ", " + j.numero : "") + (j.bairro ? " – " + j.bairro : ""));
        fill("cidade", j.municipio ? j.municipio.charAt(0) + j.municipio.slice(1).toLowerCase() : "");
        if (j.uf) $("#uf").value = j.uf;
        if (j.ddd_telefone_1) fill("empresaTelefone", MASKS.phone(onlyDigits(j.ddd_telefone_1)));
        hint.textContent = "Dados preenchidos a partir da Receita Federal. Confira e ajuste se necessário.";
        saveDraft();
      }).catch(function () {
        hint.textContent = "Não encontramos automaticamente. Preencha os dados da empresa manualmente.";
      });
    });
  }

  /* ---------------- relatório ---------------- */
  var reportForm = $("#reportForm");
  reportForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("#reportError"), ok = $("#reportOk"), btn = $("#btnReport");
    err.hidden = true; ok.hidden = true;

    var prot = $("#rProtocolo"), cpf = $("#rCpf");
    [prot, cpf].forEach(clearInvalid);
    var bad = false;
    if (!/^EST-\d{4}-\d{6}$/i.test(prot.value.trim())) { markInvalid(prot, "Formato esperado: EST-2026-000000"); bad = true; }
    if (!isValidCPF(cpf.value)) { markInvalid(cpf, "CPF inválido."); bad = true; }
    if (bad) return;

    btn.disabled = true;
    validateLinks(reportForm).then(function (linksOk) {
      if (!linksOk) throw new Error("O link do relatório (e dos opcionais preenchidos) precisa estar como “✓ Público”.");
      btn.textContent = "Enviando…";
      var data = { protocolo: prot.value.trim().toUpperCase(), cpf: cpf.value };
      fieldsIn(reportForm).forEach(function (f) { data[f.name] = f.value(); });
      return api("submitReport", data);
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || "Não foi possível registrar o relatório.");
      ok.textContent = "✓ Relatório entregue para o protocolo " + prot.value.trim().toUpperCase() + ". " + (res.message || "");
      ok.hidden = false;
      fieldsIn(reportForm).forEach(function (f) { f.input.value = ""; f.reset(); });
    }).catch(function (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Entregar relatório";
    });
  });

  /* ---------------- interface geral ---------------- */
  function bindTabs() {
    var tabs = $$(".tab");
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { activate(i); });
      tab.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          var j = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          activate(j); tabs[j].focus();
        }
      });
    });
    function activate(i) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
    }
  }

  function bindMenu() {
    var btn = $("#menuToggle"), nav = $("#mainNav");
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open);
    });
    $$("a", nav).forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("is-open"); btn.setAttribute("aria-expanded", false); });
    });
  }

  function init() {
    if (DEMO) $("#demoBanner").hidden = false;
    if (CONFIG.CONTATO_EMAIL) {
      $$(".contact-email").forEach(function (a) { a.href = "mailto:" + CONFIG.CONTATO_EMAIL; a.textContent = CONFIG.CONTATO_EMAIL; });
    }
    $("#year").textContent = new Date().getFullYear();
    renderCourses();
    renderUFs();
    bindMasks(document);
    bindTabs();
    bindMenu();
    bindCnpjLookup();
    restoreDraft();
    showStep(1);
  }

  init();
})();
