# Central de Pendências · My Broker CSC Financeiro

Portal de acompanhamento de pendências financeiras, com importação de
planilhas do ERP, edição em tempo real e exportação para Excel.

Este guia assume que você nunca usou GitHub, Supabase ou Vercel antes.
Leva entre 15 e 25 minutos para publicar o portal com uma URL real.

---

## Visão geral do que vamos fazer

1. Criar uma conta gratuita no **Supabase** (banco de dados) e criar a tabela
2. Criar uma conta gratuita no **GitHub** (onde o código vai ficar guardado)
3. Criar uma conta gratuita na **Vercel** (que hospeda o site e gera a URL)
4. Conectar os três e publicar

Nenhum desses serviços pede cartão de crédito no plano gratuito.

---

## Passo 1 — Criar o banco de dados no Supabase

1. Acesse **https://supabase.com** e clique em **Start your project** / **Sign up**.
   Pode entrar com sua conta Google para agilizar.
2. Clique em **New Project**.
   - Dê um nome, por exemplo `central-pendencias-mybroker`.
   - Crie uma senha para o banco de dados e **guarde ela em algum lugar seguro**
     (você não vai precisar dela no dia a dia, mas é bom ter salva).
   - Escolha a região mais próxima do Brasil (geralmente `South America (São Paulo)`).
   - Clique em **Create new project** e espere ~2 minutos enquanto ele é criado.
3. Quando o projeto abrir, vá no menu lateral em **SQL Editor**.
4. Clique em **New query**.
5. Abra o arquivo `schema.sql` que está nesta pasta, copie todo o conteúdo,
   cole no editor SQL do Supabase, e clique em **Run** (ou Ctrl+Enter).
   - Isso cria a tabela `pendencias` com todos os campos do portal.
6. Agora vá em **Project Settings** (ícone de engrenagem no menu lateral) →
   **API**.
   - Copie o valor de **Project URL** (algo como `https://abcxyz.supabase.co`).
   - Copie o valor de **anon public** key (uma chave longa).
   - Guarde os dois — vamos usá-los no Passo 4.

---

## Passo 2 — Subir o código no GitHub

1. Acesse **https://github.com** e clique em **Sign up** para criar uma conta
   gratuita (se ainda não tiver).
2. Depois de logado, clique no **+** no canto superior direito → **New repository**.
   - Nome: `central-pendencias-mybroker`.
   - Deixe como **Private** (privado) se preferir que só você veja o código.
   - Não marque nenhuma opção de inicialização (README, .gitignore etc.) —
     vamos subir os arquivos já prontos.
   - Clique em **Create repository**.
3. Na tela seguinte, o GitHub vai mostrar instruções de "upload an existing file".
   Clique no link **uploading an existing file**.
4. Arraste TODOS os arquivos e pastas desta entrega (descompactados) para a
   área de upload do GitHub.
5. Escreva uma mensagem como "primeira versão" e clique em **Commit changes**.

---

## Passo 3 — Publicar na Vercel

1. Acesse **https://vercel.com** e clique em **Sign up**.
   - Escolha **Continue with GitHub** — isso já conecta as duas contas.
2. No painel da Vercel, clique em **Add New...** → **Project**.
3. Encontre o repositório `central-pendencias-mybroker` que você criou no
   Passo 2 e clique em **Import**.
4. Antes de clicar em Deploy, abra a seção **Environment Variables** e
   adicione as duas variáveis que você guardou no Passo 1:

   | Name                            | Value                                  |
   |----------------------------------|-----------------------------------------|
   | `NEXT_PUBLIC_SUPABASE_URL`       | (a Project URL que você copiou)         |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | (a anon public key que você copiou)     |

5. Clique em **Deploy** e espere 1-2 minutos.
6. Quando terminar, a Vercel mostra a URL pública do seu portal, algo como:
   `https://central-pendencias-mybroker.vercel.app`

Essa é a URL que você compartilha com toda a empresa. Qualquer pessoa com o
link já consegue ver e editar as pendências — sem precisar de senha, como
você pediu.

---

## Passo 4 — Testar

1. Abra a URL gerada pela Vercel.
2. Clique em **+ Nova Pendência**, preencha e salve.
3. Recarregue a página (F5) — a pendência deve continuar lá. Isso confirma
   que está realmente salvando no banco de dados, e não só na memória do
   navegador.
4. Teste também a importação de uma planilha do ERP pelo botão
   **↓ Importar ERP**.

---

## E se eu precisar mudar alguma coisa depois?

Qualquer alteração no código (cores, campos, textos) pode ser feita editando
os arquivos no GitHub (ou peça para o Claude gerar a versão atualizada) e
fazendo um novo commit. A Vercel publica automaticamente uma nova versão
sempre que o código no GitHub é atualizado — não precisa repetir o Passo 3.

---

## Estrutura dos arquivos

```
central-pendencias-mybroker/
├── pages/
│   ├── index.js       → toda a lógica e visual do portal
│   └── _app.js         → arquivo técnico do Next.js (não precisa editar)
├── styles/
│   └── globals.css     → identidade visual My Broker (cores, fontes)
├── lib/
│   └── supabase.js      → conexão com o banco de dados
├── schema.sql           → script para criar a tabela no Supabase (Passo 1)
├── package.json         → lista de dependências do projeto
├── next.config.js       → configuração técnica do Next.js
├── .gitignore            → arquivos que não devem ir para o GitHub
└── .env.local.example   → modelo de variáveis de ambiente (não precisa usar
                            diretamente — você configura isso na Vercel)
```

---

## Segurança — importante saber

Como o requisito era acesso público sem login, a tabela do banco de dados
está configurada para permitir leitura e escrita de qualquer pessoa com a
URL. Isso significa que, tecnicamente, qualquer pessoa que descobrir o link
do site também pode editar ou excluir pendências. Para o estágio atual
("é só um modelo", nas suas palavras) isso é adequado. Se no futuro este
portal virar uma ferramenta oficial usada por toda a empresa, vale considerar
adicionar um login simples — é uma evolução natural e podemos fazer quando
for o momento.
