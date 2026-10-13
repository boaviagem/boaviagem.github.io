# Comensais

App web para controlar quantas pessoas fazem cada refeição da casa (café da manhã, almoço e jantar).
Roda como site estático no GitHub Pages (`https://boaviagem.github.io`) e usa o **Firebase**
(plano gratuito) para login por e-mail/senha e para guardar os dados.

## Perfis

| Perfil | O que faz |
|---|---|
| **Administrador** (pode haver vários) | No painel, toca numa pessoa para tirá-la da refeição, mudar o horário ou deixar observação (ou inclui outra pessoa). Cria, modifica, desativa e exclui comensais e convidados (iniciais, nome, regime, regra padrão); importa a planilha; cria logins; vê o painel com nomes; altera as refeições e regras de qualquer pessoa; deixa recados do dia para a cozinha (com “+N pessoas” numa refeição); troca mensagens com a administradora da cozinha; vê estatísticas; define horários padrão. |
| **Comensal** | Vê as próximas refeições; desmarca/marca uma refeição pontual; escolhe +cedo / +tarde / para levar (com horário opcional); deixa observação (ex.: “jantar +leve”); altera a própria regra padrão; cria regras temporárias (ex.: viagem). |
| **Administradora da cozinha** | Painel do dia e da semana (totais, +cedo/+tarde com horário, para levar, regimes que não fazem a refeição, observações, recados) — **somente iniciais**; estatísticas; mensagens para o administrador; cria e remove contas de auxiliares. |
| **Auxiliar de cozinha** | Mesma visão da administradora da cozinha, sem criar contas nem enviar mensagens. |

A cozinha não tem acesso aos nomes: eles ficam na coleção `names`, que as regras do Firestore
(`firestore.rules`) bloqueiam para esse perfil.

## Como as regras se combinam

Para cada pessoa, dia e refeição vale, nesta ordem (o último ganha):

1. **Regra padrão** — grade semanal (7 dias × 3 refeições). Cada célula: não faz, ✓ normal, +cedo, +tarde ou para levar, com horário opcional.
2. **Regra temporária** — período com outra grade (ou “ausente”, para viagens), ou uma **repetição mensal**
   (ex.: “1º domingo de cada mês, de sábado a domingo”). Se houver mais de uma no mesmo dia, vale a criada por último.
3. **Alteração pontual** — um dia e uma refeição específicos (vou / não vou, horário, observação).

Horários padrão (editáveis em Configurações): almoço +tarde 14:00, jantar +tarde 21:00.

## Prazo de aviso, alertas e churrasco

- A cozinha é avisada às 8h30: almoço e jantar do dia e café do dia seguinte; na sexta, todo o fim de semana
  até o café de segunda. Mudanças até **8h15** desse dia (ajustável em Configurações).
- Depois do prazo, quem muda vê um aviso e a cozinha recebe um **alerta** (coleção `alerts`), com botão “Ciente”.
  Vale também para mudanças de regra padrão/temporária que atinjam refeições já avisadas.
- Refeições que já passaram (café após 10h, almoço após 15h, jantar após 22h) ficam bloqueadas para os comensais.
- No painel, o administrador tem em cada refeição: **+ Pessoas** (+1, +2, +5…), **Churrasco** (participantes e público:
  estudantes, profissionais ou misto; o total passa a ser o nº de participantes) e **Alterar pessoa…**.

## Observações dos comensais

Ficam na coleção `notes`, separadas das alterações (que a cozinha lê). Pelas regras do Firestore, a cozinha só lê
as observações com `approved == true`: as dos comensais nascem ocultas e o administrador as libera no painel
("liberar para a cozinha"); as escritas pelo administrador já nascem liberadas (opção no diálogo).
Os alertas de mudança tardia não incluem o texto das observações. O churrasco só é oferecido nos almoços de sábado e domingo.

## Regime e aniversário

- **Regime:** texto por pessoa (`people.dietText`), editado só pelo administrador em Pessoas → Editar; a cozinha vê
  no painel (lista “Regimes” e ao tocar/passar sobre as iniciais roxas).
- **Aniversário:** dia e mês (`people.birthday`, `MM-DD`), preenchido pela própria pessoa em Conta ou pelo
  administrador; a cozinha vê no painel (hoje e próximos 7 dias) e na semana.

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

### Chave da API (alerta do GitHub)

A `apiKey` em `js/firebase-config.js` é a chave **pública** da configuração Web do Firebase: todo navegador que abre
o site a recebe, então tirá-la do repositório não a esconderia. Quem protege os dados são as regras do Firestore.
Para limitar o uso, ela foi restrita no Google Cloud Console (APIs e serviços → Credenciais → Browser key):
referenciadores `https://boaviagem.github.io/*`, `https://ccbv-comensais.firebaseapp.com/*`, `http://localhost:*/*`
e APIs Identity Toolkit, Token Service e Cloud Firestore. O alerta de "secret scanning" pode ser fechado como falso positivo.

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
- `notes/{pessoa_data_refeição}` — observação: `text`, `approved` (a cozinha só lê as liberadas)
- `events/{data_refeição}` — churrasco: `count`, `audience`, `note`
- `alerts/{id}` — mudanças depois do prazo: `initials`, `items[]`, `createdAt`, `ackAt`
- `settings/app` — horários padrão; `settings/bootstrap` — marca do primeiro administrador
