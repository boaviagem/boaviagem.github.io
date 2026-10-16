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

- `notes` (com o autor): só o administrador e o próprio autor leem. As dos comensais nascem ocultas.
- O administrador edita, apaga, libera ou oculta cada observação no painel. Ao liberar, o app cria em
  `kitchenNotes` uma **cópia anônima** (data, refeição, texto), que é o que a cozinha lê — sem as iniciais.
- Se o comensal editar ou apagar a observação, a cópia da cozinha é apagada e ela volta a ficar oculta.
- Os alertas de mudança tardia não incluem o texto das observações. O churrasco só aparece nos almoços de sáb/dom.

## Navegação, limite para se incluir e panorama

- **Painel e Semana:** no celular, deslize o dedo para a esquerda/direita para ir ao dia/semana seguinte/anterior.
- **Incluir-se numa refeição** (quem não faria): até **1 hora antes do horário normal** da refeição
  (Configurações → Horários: café 7h30, almoço 12h30, jantar 19h30 por padrão). Depois disso, só o administrador.
- **Pessoas → Panorama** (administrador): viagens/ausências, outras regras temporárias e aniversários do período,
  e um mapa de presença (refeições por dia; ✈ = ausência) para os próximos 7, 14 ou 30 dias.

## Vários centros

Cada centro é independente: seus dados ficam em `houses/{casa}/…` e só quem é da casa (`users.houseId`) tem acesso —
garantido pelas regras do Firestore. As contas (`users`) são comuns.

- **Gestor geral** (`users.gestor = true`): na aba **Centros**, cria centros e as contas de CL de cada uma. Não lê os dados
  internos das casas (só os da própria casa, se também for CL dela).
- **CL** (`role: 'admin'`): administra a casa.
- O CL apaga automaticamente, uma vez por dia, registros com mais de 45 dias (alterações, observações, recados, alertas,
  chamados, viagens encerradas) — os totais diários continuam nas estatísticas. Mantém o app leve e dentro do plano gratuito.

### Migração do formato antigo (uma casa, dados na raiz) — uma vez
1. No console do Firestore, na conta do gestor (`users/{uid}`), acrescentar `gestor: true` (booleano) e `houseId: "ccbv"` (texto).
2. Publicar o novo `firestore.rules` (a partir daqui a versão antiga do app para de funcionar).
3. Publicar o código novo (`git push`).
4. Entrar como gestor → **Casas** → criar a casa `ccbv` → **Migrar dados antigos**. Os dados antigos não são apagados
   (o gestor ainda pode lê-los). Para voltar atrás: publicar as regras e o código anteriores.

## Papéis de conta

| Papel (`users.role`) | Nome no app | O que faz |
|---|---|---|
| `admin` | CL | administra a casa |
| `comensal` | Comensal | as próprias refeições |
| `cozinha` | Administradora | painel/semana/estatísticas só com iniciais; cria Numerárias Auxiliares; mensagens |
| `auxiliar` | Numerária Auxiliar | mesma visão da Administradora, sem criar contas nem mandar mensagens |

Mensagens: cada mensagem pode ser respondida (`replyTo`), formando conversas.

## Chamar o administrador

No painel da cozinha (administradora e auxiliares), o botão **🔔 Chamar o administrador** registra um chamado
(motivo + mensagem opcional) em `calls`. Com o app aberto, o administrador vê na hora uma faixa vermelha no topo
(com bipe e, se ativada em Conta, notificação do navegador) e clica em **Visto**; a cozinha vê o status.
Com o app fechado, o chamado aparece quando o administrador abrir o app (aviso no celular exigiria push/plano pago).

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
- `notes/{pessoa_data_refeição}` — observação com autor: `text`, `approved`, `kitchenId` (admin e autor)
- `calls/{id}` — chamados da cozinha: `reason`, `text`, `createdAt`, `seenAt`
- `kitchenNotes/{id}` — cópia anônima das observações liberadas (`date`, `meal`, `text`), lida pela cozinha
- `events/{data_refeição}` — churrasco: `count`, `audience`, `note`
- `alerts/{id}` — mudanças depois do prazo: `initials`, `items[]`, `createdAt`, `ackAt`
- `settings/app` — horários padrão; `settings/bootstrap` — marca do primeiro administrador
