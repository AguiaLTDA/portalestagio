/**
 * Portal de Estágio UniVC — backend em Google Apps Script.
 *
 * Instalação (resumo; detalhes no README.md):
 *   1. Crie uma Planilha Google e abra Extensões > Apps Script.
 *   2. Cole este arquivo como Code.gs e salve.
 *   3. Execute a função `setup` uma vez (autorize as permissões).
 *   4. Implantar > Nova implantação > App da Web
 *        Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa
 *   5. Copie a URL /exec para assets/config.js (APPS_SCRIPT_URL).
 *
 * A verificação dos links é feita SEM login: o servidor abre o link como um
 * visitante anônimo. Se o Google/Microsoft redirecionar para a tela de login,
 * o arquivo não está público.
 */

var ABA_ESTAGIOS = 'Estágios';
var ABA_EMPRESAS = 'Empresas';
var ABA_LOG = 'Log';

var CURSOS = [
  'Administração', 'Agronomia', 'Análise e Desenvolvimento de Sistemas', 'Arquitetura e Urbanismo',
  'Ciências Contábeis', 'Direito', 'Educação Física', 'Enfermagem', 'Engenharia Civil',
  'Engenharia de Produção', 'Engenharia Mecânica', 'Farmácia', 'Fisioterapia',
  'Medicina Veterinária', 'Odontologia', 'Psicologia', 'Publicidade e Propaganda'
];

var COLUNAS_ESTAGIOS = [
  'Protocolo', 'Data do cadastro', 'Situação',
  'Nome', 'CPF', 'Matrícula', 'Data de nascimento', 'Celular', 'E-mail', 'Curso', 'Turno', 'Período',
  'Empresa', 'CNPJ', 'Endereço', 'Cidade', 'UF',
  'Supervisor', 'Cargo do supervisor', 'E-mail do supervisor', 'Telefone do supervisor',
  'Tipo', 'Modalidade', 'Início', 'Término', 'Horas/semana', 'Carga total', 'Orientador', 'Atividades',
  'Link TCE', 'Status TCE', 'Link Plano de Atividades', 'Status Plano', 'Link Seguro', 'Status Seguro',
  'Link Relatório', 'Status Relatório', 'Link Avaliação', 'Status Avaliação', 'Link Frequência', 'Status Frequência',
  'Data entrega relatório', 'Última verificação de links', 'Observações da coordenação'
];

var COLUNAS_EMPRESAS = [
  'CNPJ', 'Razão social', 'Endereço', 'Cidade', 'UF', 'Telefone', 'E-mail',
  'Primeiro cadastro', 'Último cadastro', 'Nº de estagiários'
];

var STATUS_TEXTO = {
  publico: 'Público',
  privado: 'Privado',
  invalido: 'Inválido',
  nao_encontrado: 'Não encontrado',
  indeterminado: 'Não verificado'
};

/* ======================== Entrada HTTP ======================== */

function doGet() {
  return json_({ ok: true, servico: 'Portal de Estágio UniVC', hora: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Requisição inválida.' });
  }
  var data = req.data || {};
  try {
    switch (req.action) {
      case 'checkLink':
        return json_(checkLink_(String(data.url || '')));
      case 'submit':
        return json_(submit_(data));
      case 'submitReport':
        return json_(submitReport_(data));
      default:
        return json_({ ok: false, error: 'Ação desconhecida.' });
    }
  } catch (err) {
    log_('erro', req.action, String(err && err.stack || err));
    return json_({ ok: false, error: 'Erro interno no servidor. Tente novamente em instantes.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================== Instalação ======================== */

/** Execute uma vez pelo editor para criar as abas e cabeçalhos. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  prepararAba_(ss, ABA_ESTAGIOS, COLUNAS_ESTAGIOS);
  prepararAba_(ss, ABA_EMPRESAS, COLUNAS_EMPRESAS);
  prepararAba_(ss, ABA_LOG, ['Data', 'Tipo', 'Ação', 'Detalhe']);

  var est = ss.getSheetByName(ABA_ESTAGIOS);
  // CPF, CNPJ, matrícula e protocolo como texto (não perder zeros à esquerda)
  ['Protocolo', 'CPF', 'Matrícula', 'CNPJ', 'Celular'].forEach(function (c) {
    est.getRange(2, COLUNAS_ESTAGIOS.indexOf(c) + 1, est.getMaxRows() - 1, 1).setNumberFormat('@');
  });
  ss.getSheetByName(ABA_EMPRESAS).getRange('A2:A').setNumberFormat('@');

  // validação de lista na coluna Situação, para a coordenação
  var regra = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Aguardando análise', 'Em análise', 'Pendência com o aluno', 'Aprovado', 'Relatório entregue', 'Concluído', 'Indeferido'], true)
    .setAllowInvalid(true).build();
  est.getRange(2, COLUNAS_ESTAGIOS.indexOf('Situação') + 1, est.getMaxRows() - 1, 1).setDataValidation(regra);

  // força o pedido de autorização de UrlFetch durante o setup
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}

function prepararAba_(ss, nome, colunas) {
  var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
  sh.getRange(1, 1, 1, colunas.length).setValues([colunas])
    .setFontWeight('bold').setBackground('#06452c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

/* ======================== Verificação de links ======================== */

var LOGIN_HOSTS = [
  'accounts.google.com',
  'login.live.com',
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.windows.net'
];

function detectarProvedor_(url) {
  var m = /^https:\/\/([^\/?#]+)/i.exec(url);
  if (!m) return null;
  var host = m[1].toLowerCase();
  if (host === 'drive.google.com' || host === 'docs.google.com') return 'google';
  if (host === '1drv.ms' || host === 'onedrive.live.com' || /\.onedrive\.live\.com$/.test(host) ||
      host === 'onedrive.com' || /\.sharepoint\.com$/.test(host)) return 'microsoft';
  return null;
}

function hostDe_(url) {
  var m = /^https?:\/\/([^\/?#]+)/i.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}

function ehLogin_(url) {
  var h = hostDe_(url);
  if (LOGIN_HOSTS.indexOf(h) >= 0) return true;
  // SharePoint usa estas rotas quando o link exige conta da organização
  return /\/_layouts\/15\/(Authenticate|AccessDenied)\.aspx|\/_forms\/default\.aspx|ServiceLogin/i.test(url);
}

function resolverUrl_(base, loc) {
  if (/^https?:\/\//i.test(loc)) return loc;
  var m = /^(https?:\/\/[^\/]+)/i.exec(base);
  if (loc.charAt(0) === '/') return m[1] + loc;
  return base.replace(/[^\/]*$/, '') + loc;
}

function header_(headers, nome) {
  nome = nome.toLowerCase();
  for (var k in headers) if (k.toLowerCase() === nome) return headers[k];
  return '';
}

/**
 * Abre a URL de forma anônima seguindo redirecionamentos manualmente e
 * classifica: publico | privado | nao_encontrado | indeterminado.
 */
function sondar_(url) {
  var atual = url;
  for (var i = 0; i < 8; i++) {
    var resp;
    try {
      resp = UrlFetchApp.fetch(atual, {
        followRedirects: false,
        muteHttpExceptions: true,
        validateHttpsCertificates: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9'
        }
      });
    } catch (err) {
      return { status: 'indeterminado', message: 'Não foi possível acessar o link agora.' };
    }
    var code = resp.getResponseCode();
    if (code >= 300 && code < 400) {
      var loc = header_(resp.getAllHeaders(), 'Location');
      if (!loc) return { status: 'indeterminado', message: 'Redirecionamento sem destino.' };
      var prox = resolverUrl_(atual, loc);
      if (ehLogin_(prox)) return { status: 'privado' };
      atual = prox;
      continue;
    }
    if (code === 200) {
      if (ehLogin_(atual)) return { status: 'privado' };
      return { status: 'publico', finalUrl: atual, body: resp.getContentText().slice(0, 200000) };
    }
    if (code === 401 || code === 403) return { status: 'privado' };
    if (code === 404 || code === 410) return { status: 'nao_encontrado' };
    if (code === 429 || code >= 500) return { status: 'indeterminado', message: 'O serviço de arquivos está instável. Tente novamente em instantes.' };
    return { status: 'indeterminado', message: 'Resposta inesperada (' + code + ').' };
  }
  return { status: 'indeterminado', message: 'Redirecionamentos demais.' };
}

/** API anônima do OneDrive pessoal: retorna metadados apenas de links públicos. */
function sondarOneDriveApi_(url) {
  var token = 'u!' + Utilities.base64EncodeWebSafe(url).replace(/=+$/, '');
  try {
    var resp = UrlFetchApp.fetch('https://api.onedrive.com/v1.0/shares/' + token + '/root?select=name', {
      muteHttpExceptions: true, followRedirects: true
    });
    var code = resp.getResponseCode();
    if (code === 200) {
      var j = JSON.parse(resp.getContentText());
      return { status: 'publico', title: j.name || '' };
    }
    if (code === 401 || code === 403) return { status: 'privado' };
    if (code === 404) return { status: 'nao_encontrado' };
  } catch (err) { /* cai para a sondagem genérica */ }
  return null;
}

function tituloDaPagina_(body) {
  if (!body) return '';
  var m = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(body) || /<title>([^<]*)<\/title>/i.exec(body);
  if (!m) return '';
  var t = m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s*-\s*(Google (Drive|Docs|Sheets|Slides|Planilhas|Documentos|Apresentações)|OneDrive|Microsoft OneDrive)\s*$/i, '')
    .trim();
  if (/^(Google Drive|OneDrive|Sign in|Fazer login|Entrar)$/i.test(t)) return '';
  return t;
}

function checkLink_(url) {
  url = url.trim();
  if (!url) return { ok: true, status: 'invalido', message: 'Link vazio.' };
  if (url.length > 2000) return { ok: true, status: 'invalido', message: 'Link longo demais.' };
  var provider = detectarProvedor_(url);
  if (!provider) {
    return { ok: true, status: 'invalido', message: 'Aceitamos apenas links do Google Drive/Docs ou do OneDrive/SharePoint.' };
  }

  var cache = CacheService.getScriptCache();
  var chave = 'lk_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, url));
  var emCache = cache.get(chave);
  if (emCache) return JSON.parse(emCache);

  var r = null;
  if (provider === 'microsoft' && !/\.sharepoint\.com$/.test(hostDe_(url))) r = sondarOneDriveApi_(url);
  if (!r) r = sondar_(url);

  var res = { ok: true, status: r.status, provider: provider };
  if (r.message) res.message = r.message;
  var titulo = r.title || tituloDaPagina_(r.body);
  if (titulo) res.title = titulo;

  // só guarda em cache resultados definitivos, por pouco tempo
  if (r.status !== 'indeterminado') cache.put(chave, JSON.stringify(res), r.status === 'publico' ? 120 : 20);
  return res;
}

/* ======================== Cadastro ======================== */

function soDigitos_(s) { return String(s || '').replace(/\D/g, ''); }

function cpfValido_(v) {
  var c = soDigitos_(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (var t = 9; t < 11; t++) {
    var soma = 0;
    for (var i = 0; i < t; i++) soma += Number(c.charAt(i)) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c.charAt(t))) return false;
  }
  return true;
}

function cnpjValido_(v) {
  var c = soDigitos_(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  function dv(len) {
    var soma = 0, pos = len - 7;
    for (var i = len; i >= 1; i--) {
      soma += Number(c.charAt(len - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    var r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  }
  return dv(12) === Number(c.charAt(12)) && dv(13) === Number(c.charAt(13));
}

/** Evita injeção de fórmulas na planilha e limita o tamanho. */
function limpo_(v, max) {
  var s = String(v == null ? '' : v).trim().slice(0, max || 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function formatarCpf_(v) { var c = soDigitos_(v); return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); }
function formatarCnpj_(v) { var c = soDigitos_(v); return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'); }

function verificarLinks_(data, nomes, obrigatorios) {
  var resultado = {}, falhas = {};
  nomes.forEach(function (n) {
    var url = String(data[n] || '').trim();
    if (!url) {
      if (obrigatorios.indexOf(n) >= 0) falhas[n] = { status: 'invalido', message: 'Link obrigatório não informado.' };
      resultado[n] = { url: '', status: '' };
      return;
    }
    var r = checkLink_(url);
    resultado[n] = { url: url, status: r.status };
    if (r.status !== 'publico') falhas[n] = r;
  });
  return { resultado: resultado, falhas: falhas };
}

function submit_(d) {
  var obrig = ['nome', 'cpf', 'matricula', 'nascimento', 'telefone', 'email', 'curso', 'turno', 'periodo',
    'cnpj', 'empresa', 'endereco', 'cidade', 'uf', 'supervisor', 'supervisorCargo', 'supervisorEmail',
    'tipo', 'modalidade', 'inicio', 'termino', 'horasSemanais', 'cargaTotal', 'orientador', 'atividades'];
  var faltando = obrig.filter(function (k) { return !String(d[k] || '').trim(); });
  if (faltando.length) return { ok: false, error: 'Campos obrigatórios não preenchidos: ' + faltando.join(', ') + '.' };
  if (!cpfValido_(d.cpf)) return { ok: false, error: 'CPF inválido.' };
  if (!cnpjValido_(d.cnpj)) return { ok: false, error: 'CNPJ inválido.' };
  if (CURSOS.indexOf(d.curso) < 0) return { ok: false, error: 'Curso inválido.' };
  if (d.lgpd !== true) return { ok: false, error: 'É preciso aceitar o termo de uso dos dados.' };

  // reverifica no servidor — não confiamos no navegador
  var links = verificarLinks_(d, ['linkTce', 'linkPlano', 'linkSeguro'], ['linkTce', 'linkPlano']);
  if (Object.keys(links.falhas).length) {
    return { ok: false, error: 'Um ou mais links não estão públicos. Corrija e verifique novamente.', links: links.falhas };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(ABA_ESTAGIOS) || prepararAba_(ss, ABA_ESTAGIOS, COLUNAS_ESTAGIOS);
    var agora = new Date();
    var protocolo = gerarProtocolo_(agora);
    var L = links.resultado;

    var linha = [
      protocolo, agora, 'Aguardando análise',
      limpo_(d.nome, 150), formatarCpf_(d.cpf), limpo_(d.matricula, 30), limpo_(d.nascimento, 10), limpo_(d.telefone, 20),
      limpo_(d.email, 150).toLowerCase(), d.curso, limpo_(d.turno, 20), limpo_(d.periodo, 5),
      limpo_(d.empresa, 200), formatarCnpj_(d.cnpj), limpo_(d.endereco, 250), limpo_(d.cidade, 100), limpo_(d.uf, 2),
      limpo_(d.supervisor, 150), limpo_(d.supervisorCargo, 120), limpo_(d.supervisorEmail, 150).toLowerCase(), limpo_(d.supervisorTelefone, 20),
      limpo_(d.tipo, 30), limpo_(d.modalidade, 20), limpo_(d.inicio, 10), limpo_(d.termino, 10),
      Number(d.horasSemanais) || '', Number(d.cargaTotal) || '', limpo_(d.orientador, 150), limpo_(d.atividades, 1500),
      limpo_(L.linkTce.url, 2000), STATUS_TEXTO[L.linkTce.status] || '',
      limpo_(L.linkPlano.url, 2000), STATUS_TEXTO[L.linkPlano.status] || '',
      limpo_(L.linkSeguro.url, 2000), STATUS_TEXTO[L.linkSeguro.status] || '',
      '', '', '', '', '', '',
      '', agora, ''
    ];
    sh.appendRow(linha);
    registrarEmpresa_(ss, d, agora);
    log_('cadastro', protocolo, d.curso);
    return { ok: true, protocolo: protocolo };
  } finally {
    lock.releaseLock();
  }
}

/** Sequencial por ano, guardado nas propriedades do script (chamado sob lock). */
function gerarProtocolo_(data) {
  var ano = data.getFullYear();
  var prefixo = 'EST-' + ano + '-';
  var props = PropertiesService.getScriptProperties();
  var chave = 'seq_' + ano;
  var seq = Number(props.getProperty(chave) || 0) + 1;
  props.setProperty(chave, String(seq));
  return prefixo + ('000000' + seq).slice(-6);
}

function registrarEmpresa_(ss, d, agora) {
  var sh = ss.getSheetByName(ABA_EMPRESAS) || prepararAba_(ss, ABA_EMPRESAS, COLUNAS_EMPRESAS);
  var cnpj = formatarCnpj_(d.cnpj);
  var n = sh.getLastRow();
  if (n > 1) {
    var cnpjs = sh.getRange(2, 1, n - 1, 1).getDisplayValues();
    for (var i = 0; i < cnpjs.length; i++) {
      if (cnpjs[i][0] === cnpj) {
        var row = i + 2;
        var qtd = Number(sh.getRange(row, 10).getValue()) || 0;
        sh.getRange(row, 9, 1, 2).setValues([[agora, qtd + 1]]);
        return;
      }
    }
  }
  sh.appendRow([cnpj, limpo_(d.empresa, 200), limpo_(d.endereco, 250), limpo_(d.cidade, 100), limpo_(d.uf, 2),
    limpo_(d.empresaTelefone, 20), limpo_(d.empresaEmail, 150).toLowerCase(), agora, agora, 1]);
}

/* ======================== Relatório ======================== */

function submitReport_(d) {
  var protocolo = String(d.protocolo || '').trim().toUpperCase();
  if (!/^EST-\d{4}-\d{6}$/.test(protocolo)) return { ok: false, error: 'Protocolo inválido.' };
  if (!cpfValido_(d.cpf)) return { ok: false, error: 'CPF inválido.' };

  var links = verificarLinks_(d, ['linkRelatorio', 'linkAvaliacao', 'linkFrequencia'], ['linkRelatorio']);
  if (Object.keys(links.falhas).length) {
    return { ok: false, error: 'Um ou mais links não estão públicos. Corrija e verifique novamente.', links: links.falhas };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_ESTAGIOS);
    var n = sh ? sh.getLastRow() : 0;
    if (n < 2) return { ok: false, error: 'Protocolo não encontrado.' };

    var col = function (nome) { return COLUNAS_ESTAGIOS.indexOf(nome) + 1; };
    var dados = sh.getRange(2, 1, n - 1, col('CPF')).getDisplayValues();
    var cpf = formatarCpf_(d.cpf);
    var row = -1;
    for (var i = 0; i < dados.length; i++) {
      if (dados[i][0] === protocolo) {
        if (dados[i][col('CPF') - 1] !== cpf) return { ok: false, error: 'O CPF não confere com o protocolo informado.' };
        row = i + 2;
        break;
      }
    }
    if (row < 0) return { ok: false, error: 'Protocolo não encontrado.' };

    var L = links.resultado;
    var agora = new Date();
    sh.getRange(row, col('Link Relatório'), 1, 6).setValues([[
      limpo_(L.linkRelatorio.url, 2000), STATUS_TEXTO[L.linkRelatorio.status] || '',
      limpo_(L.linkAvaliacao.url, 2000), STATUS_TEXTO[L.linkAvaliacao.status] || '',
      limpo_(L.linkFrequencia.url, 2000), STATUS_TEXTO[L.linkFrequencia.status] || ''
    ]]);
    sh.getRange(row, col('Data entrega relatório'), 1, 2).setValues([[agora, agora]]);
    sh.getRange(row, col('Situação')).setValue('Relatório entregue');
    log_('relatorio', protocolo, '');
    return { ok: true, message: 'A Coordenação de Estágios fará a análise.' };
  } finally {
    lock.releaseLock();
  }
}

/* ======================== Rotina opcional para a coordenação ======================== */

/**
 * Reverifica todos os links da planilha (ex.: gatilho diário) e marca os que
 * deixaram de ser públicos. Configure em Acionadores > Adicionar acionador.
 */
function reverificarTodosOsLinks() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_ESTAGIOS);
  var n = sh.getLastRow();
  if (n < 2) return;
  var pares = [
    ['Link TCE', 'Status TCE'], ['Link Plano de Atividades', 'Status Plano'], ['Link Seguro', 'Status Seguro'],
    ['Link Relatório', 'Status Relatório'], ['Link Avaliação', 'Status Avaliação'], ['Link Frequência', 'Status Frequência']
  ];
  var valores = sh.getRange(2, 1, n - 1, COLUNAS_ESTAGIOS.length).getValues();
  var colData = COLUNAS_ESTAGIOS.indexOf('Última verificação de links') + 1;
  var inicio = Date.now();
  for (var i = 0; i < valores.length; i++) {
    if (Date.now() - inicio > 5 * 60 * 1000) break; // limite de execução do Apps Script
    // grava só as colunas de status, para não reescrever dados digitados pelos alunos
    pares.forEach(function (p) {
      var ci = COLUNAS_ESTAGIOS.indexOf(p[0]), cs = COLUNAS_ESTAGIOS.indexOf(p[1]);
      var url = String(valores[i][ci] || '');
      if (url) sh.getRange(i + 2, cs + 1).setValue(STATUS_TEXTO[checkLink_(url).status] || '');
    });
    sh.getRange(i + 2, colData).setValue(new Date());
  }
}

function log_(tipo, acao, detalhe) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(ABA_LOG) || prepararAba_(ss, ABA_LOG, ['Data', 'Tipo', 'Ação', 'Detalhe']);
    sh.appendRow([new Date(), tipo, acao, String(detalhe).slice(0, 1000)]);
  } catch (e) { /* log nunca deve derrubar a requisição */ }
}

/** Teste rápido pelo editor: Executar > testarVerificacao */
function testarVerificacao() {
  var url = 'COLE_AQUI_UM_LINK_DO_DRIVE';
  Logger.log(JSON.stringify(checkLink_(url)));
}
