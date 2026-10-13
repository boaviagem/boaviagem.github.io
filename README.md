# Comensais

App web para controlar quantas pessoas fazem cada refeição da casa (café da manhã, almoço e jantar).
Roda como site estático no GitHub Pages (`https://boaviagem.github.io`) e usa o **Firebase**
(plano gratuito) para login por e-mail/senha e para guardar os dados.

## Perfis

| Perfil | O que faz |
|---|---|
| **Administrador** (pode haver vários) | Cria, modifica, desativa e exclui comensais e convidados (iniciais, nome, regime, regra padrão); importa a planilha; cria logins; vê o painel com nomes; altera as refeições e regras de qualquer pessoa; deixa recados do dia para a cozinha (com “+N pessoas” numa refeição); troca mensagens com a administradora da cozinha; vê estatísticas; define horários padrão. |
| **Comensal** | Vê as próximas refeições; desmarca/marca uma refeição pontual; escolhe +cedo / +tarde / para levar (com horário opcional); deixa observação (ex.: “jantar +leve”); altera a própria regra padrão; cria regras temporárias (ex.: viagem). |
| **Administradora da cozinha** | Painel do dia e da semana (totais, +cedo/+tarde com horário, para levar, regimes que não fazem a refeição, observações, recados) — **somente iniciais**; estatísticas; mensagens para o administrador; cria e remove contas de auxiliares. |
| **Auxiliar de cozinha** | Mesma visão da administradora da cozinha, sem criar contas nem enviar mensagens. |

A cozinha não tem acesso aos nomes: eles ficam na coleção `names`, que as regras do Firestore
(`firestore.rules`) bloqueiam para esse perfil.

## Como as regras se combinam

Para cada pessoa, dia e refeição vale, nesta ordem (o último ganha):

1. **Regra padrão** — grade semanal (7 dias × 3 refeições). Cada célula: não faz, ✓ normal, +cedo, +tarde ou para levar, com horário opcional.
2. **Regra temporária** — período com outra grade (ou “ausente”, para viagens). Se houver mais de uma no mesmo dia, vale a criada por último.
3. **Alteração pontual** — um dia e uma refeição específicos (vou / não vou, horário, observação).

Horários padrão (editáveis em Configurações): almoço +tarde 14:00, jantar +tarde 21:00.

## Planilha de comensais

Em **Pessoas → Importar planilha** (arquivo .xlsx). Colunas reconhecidas na primeira linha:
`Iniciais`, `E-mail`, `Nome`, `Regime` (“sim”), `Papel` (“comensal” ou “admin”) e uma coluna por refeição
(`Seg Café`, `Seg Almoço`, … `Dom Jantar`) com: vazio = não faz, `x` = faz, `cedo`, `tarde` ou `levar`,
opcionalmente com horário (`tarde 21:30`). Quem já existe (mesmas iniciais) é atualizado; quem tem e-mail e ainda
não tem login ganha um — por e-mail para criar a senha, ou com uma senha provisória comum (trocada no 1º acesso).
A planilha com os dados reais fica **fora** deste repositório.

## Estatísticas

Ao abrir o painel de um dia (hoje ou passado), o app grava uma “fotografia” dos totais em `daily/{data}`.
As estatísticas usam essas fotografias para os dias passados e recalculam pelas regras os dias sem registro.

## Modo demonstração

Sem Firebase configurado (ou abrindo `index.html?demo`), o app roda com dados de exemplo
guardados só no navegador. Para testar localmente:

```bash
python -m http.server 8765
```

e abra `http://localhost:8765/?demo`. Testes da lógica: `http://localhost:8765/test/` (ou `node test/logic.test.mjs`).

## Instalação (uma vez)

O projeto Firebase pode pertencer a **qualquer conta Google** — não precisa ser a mesma do GitHub nem a dos
comensais. Sugestão: uma conta da casa, adicionando depois sua conta pessoal como Proprietário
(Configurações do projeto → Usuários e permissões), para ninguém ficar refém de uma conta só.
O plano gratuito (Spark) não pede cartão e sobra para este uso.

1. **Criar o projeto Firebase** em <https://console.firebase.google.com> (plano Spark, gratuito; o Google Analytics pode ficar desligado).
2. **Authentication** → Começar → Método de login → ativar **E-mail/senha**.
   Em Authentication → Configurações → **Domínios autorizados**, adicionar `boaviagem.github.io`.
   Em Authentication → **Modelos** (Templates), mudar o idioma para português, para os e-mails de senha.
3. **Firestore Database** → Criar banco de dados → modo de produção → região `southamerica-east1 (São Paulo)`.
   Na aba **Regras**, colar o conteúdo de `firestore.rules` e clicar em **Publicar**.
4. **Configurações do projeto** → Seus apps → **Web (</>)** → registrar o app → copiar o objeto
   `firebaseConfig` para `js/firebase-config.js`. (Esses valores não são secretos.)
5. **Publicar no GitHub Pages**: o conteúdo desta pasta vai para o repositório `boaviagem.github.io`
   da conta/organização `boaviagem` (branch `main`, raiz). Em Settings → Pages, Source = “Deploy from a branch”, `main` / `(root)`.
6. **Primeiro acesso do administrador**: em Authentication → Users → **Adicionar usuário** com seu e-mail e senha.
   Entre no app com ele e clique em **“Sim, sou o administrador”** (só funciona uma vez).
   Depois, em **Pessoas → + Adicionar**, cadastre-se com a opção **“É a minha conta”**.
7. Importe a planilha (Pessoas → Importar planilha) ou cadastre um a um, e crie a **conta da administradora da cozinha**.
   Ela mesma cria as contas das auxiliares em **Equipe**.

### Observações

- Excluir um comensal no app apaga os dados e o acesso dele; o login em si (e-mail/senha) só some de vez no
  console do Firebase (Authentication → Users). Para só tirar dos totais, desmarque “Ativo”.
- Convidados: cadastre com “Convidado” marcado e regra “Nenhuma refeição”, e marque os dias em
  Refeições (pontual) ou Temporárias (período).

## Estrutura

```
index.html            página única
css/style.css         estilos (claro/escuro, celular primeiro)
js/app.js             interface e telas
js/logic.js           regras, datas e totais (lógica pura, testável)
js/data-firebase.js   acesso ao Firebase (Auth + Firestore)
js/data-demo.js       dados de exemplo (modo demonstração)
js/firebase-config.js configuração do projeto Firebase
firestore.rules       regras de segurança do banco
test/                 testes da lógica
```

### Coleções no Firestore

- `users/{uid}` — `role` (`admin` | `comensal` | `cozinha`), `personId`, `email`
- `people/{id}` — `initials`, `diet`, `guest`, `active`, `uid`, `defaultRule`
- `names/{id}` — `fullName`, `email` (invisível para a cozinha)
- `periods/{id}` — `personId`, `from`, `to`, `label`, `grid`, `createdAt`
- `overrides/{personId_data_refeição}` — `status`, `when`, `time`, `note`
- `dayNotes/{id}` — recados do administrador: `date`, `meal` (vazio = geral), `text`, `extra`
- `messages/{id}` — `dir` (`k2a` cozinha→admin, `a2k` admin→cozinha), `text`, `from`, `createdAt`, `readAt`
- `daily/{data}` — totais gravados de cada dia (estatísticas)
- `settings/app` — horários padrão; `settings/bootstrap` — marca do primeiro administrador
