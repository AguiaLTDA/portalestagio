# Portal de Estágio UniVC

Página do Centro Universitário Vale do Cricaré em que os alunos:

1. se cadastram (dados pessoais + escolha entre os 17 cursos);
2. cadastram a empresa concedente e o supervisor;
3. informam os dados do estágio;
4. enviam os **links públicos** dos documentos (TCE, Plano de Atividades, seguro);
5. depois, entregam o **relatório final** usando o protocolo recebido.

Nenhum arquivo é enviado ao portal. O aluno sobe o arquivo no **próprio Google Drive ou OneDrive**, deixa o link público e cola o link no portal. O servidor confere se o link abre **sem login** antes de aceitar. Os dados ficam numa **Planilha Google**, gravados por um **Google Apps Script**.

## Estrutura

```
index.html            página única (estático, pode ir para o GitHub Pages)
assets/style.css      identidade visual (verde UniVC, Montserrat/Poppins)
assets/app.js         formulário em etapas, máscaras, validações, verificação dos links
assets/config.js      URL do Apps Script e e-mail de contato  ← editar
assets/logo-univc.png logotipo
apps-script/Code.gs   backend: grava na planilha e verifica os links
```

## Instalação

### 1. Planilha e Apps Script

1. Crie uma Planilha Google (ex.: “Portal de Estágio UniVC”), de preferência numa conta institucional da coordenação.
2. Na planilha: **Extensões › Apps Script**.
3. Apague o conteúdo de `Code.gs` e cole o arquivo [`apps-script/Code.gs`](apps-script/Code.gs). Salve.
4. Selecione a função **`setup`** e clique em **Executar**. Autorize as permissões (planilha e acesso a URLs externas). São criadas as abas **Estágios**, **Empresas** e **Log**.
5. **Implantar › Nova implantação › Tipo: App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
6. Copie a URL que termina em `/exec`.

> Sempre que alterar o `Code.gs`, use **Implantar › Gerenciar implantações › Editar › Nova versão**. Assim a URL continua a mesma.

### 2. Front-end

1. Em [`assets/config.js`](assets/config.js), cole a URL em `APPS_SCRIPT_URL` e ajuste `CONTATO_EMAIL`.
2. Publique a pasta. Com o GitHub Pages: **Settings › Pages › Deploy from a branch › main / (root)**.

Sem a URL configurada, o portal funciona em **modo demonstração**: mostra uma faixa amarela no topo, não grava nada e só confere o formato dos links.

## Como a verificação de link público funciona

Ao clicar em **Verificar**, e de novo no envio, o Apps Script abre o link com `UrlFetchApp`, **sem nenhum login**, seguindo os redirecionamentos um a um:

| O que acontece | Resultado |
|---|---|
| Página abre normalmente (HTTP 200) | ✓ Público (mostra o nome do arquivo quando possível) |
| Redireciona para `accounts.google.com`, `login.live.com`, `login.microsoftonline.com`… | ✗ Privado |
| HTTP 401 / 403 | ✗ Privado |
| HTTP 404 | ✗ Não encontrado / sem acesso público |
| Domínio fora de Google Drive/Docs ou OneDrive/SharePoint | ✗ Inválido |

Para links do OneDrive pessoal (`1drv.ms`, `onedrive.live.com`), o script consulta primeiro a API anônima de compartilhamento do OneDrive, que só responde quando o link é público. O navegador mostra o resultado na hora, com instruções de correção específicas para cada drive. O envio é **bloqueado** enquanto algum link obrigatório não estiver público, e o servidor repete a verificação no momento da gravação (não depende do navegador).

Opcional: crie um acionador diário para a função `reverificarTodosOsLinks` (**Acionadores › Adicionar acionador**). Ela atualiza as colunas de status e mostra quem apagou ou fechou um arquivo depois do envio.

## Planilha

- **Estágios**: uma linha por cadastro, com protocolo `EST-AAAA-000000`, dados do aluno, empresa, estágio, links, status de cada link, data de entrega do relatório e uma coluna livre para observações da coordenação. A coluna **Situação** tem uma lista (Aguardando análise, Em análise, Pendência com o aluno, Aprovado, Relatório entregue, Concluído, Indeferido).
- **Empresas**: cadastro único por CNPJ, com contagem de estagiários.
- **Log**: registro de envios e erros.

## Cursos

A lista dos 17 cursos está em dois lugares, que precisam ficar iguais: `COURSES` em `assets/app.js` e `CURSOS` em `apps-script/Code.gs`.

## Observações

- O CNPJ preenche automaticamente razão social e endereço pela BrasilAPI (dados públicos da Receita). Se a consulta falhar, o aluno preenche à mão.
- O rascunho do formulário fica salvo no navegador do aluno até o envio.
- Valores que começam com `=`, `+`, `-` ou `@` são gravados como texto, para evitar injeção de fórmulas na planilha.
