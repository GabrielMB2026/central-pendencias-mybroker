# 📋 Central de Pendências My Broker

Plataforma interna de gestão de pendências financeiras desenvolvida para a **Rede My Broker Imóveis**, uma rede de franquias imobiliárias com mais de 45 empresas afiliadas.

---

## 🧩 O Problema

O time financeiro da franqueadora precisava acompanhar, priorizar e resolver pendências de depósitos e comissões distribuídas entre dezenas de empresas da rede — um processo que antes dependia de planilhas manuais, sem visibilidade centralizada, sem rastreabilidade de ações e sujeito a inconsistências.

---

## 💡 A Solução

Uma aplicação web interna que centraliza todas as pendências financeiras da rede, com controle de status, responsáveis, histórico de ações e funcionalidades de gestão em massa.

![Screenshot da aplicação](./screenshots/dashboard.png)
> *Interface de gestão com filtros por empresa, status e responsável*

---

## ✨ Principais funcionalidades

- **Visualização centralizada** de pendências por empresa, tipo e status
- **Atualização de status** individual e em massa (bulk actions)
- **Exclusão em massa** com confirmação de segurança
- **Filtros dinâmicos** por empresa, responsável e categoria de pendência
- **Autenticação** com controle de acesso por perfil
- **Interface responsiva** otimizada para uso interno no dia a dia

---

## 🛠️ Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router) |
| Backend / BaaS | Supabase (PostgreSQL + Auth + Realtime) |
| Deploy | Vercel |
| Estilização | Tailwind CSS |

---

## 🏗️ Arquitetura

```
central-de-pendencias/
├── app/
│   ├── (auth)/          # Fluxo de autenticação
│   ├── dashboard/       # Telas principais da aplicação
│   └── api/             # Rotas de API internas
├── components/          # Componentes reutilizáveis
├── lib/
│   └── supabase/        # Cliente e helpers do Supabase
└── types/               # Tipagens TypeScript
```

---

## 🚀 Como rodar localmente

### Pré-requisitos
- Node.js 18+
- Conta no [Supabase](https://supabase.com)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/central-de-pendencias.git
cd central-de-pendencias

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env.local
```

### Variáveis de ambiente necessárias

```env
NEXT_PUBLIC_SUPABASE_URL=sua_url_do_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anonima
```

```bash
# Inicie o servidor de desenvolvimento
npm run dev
```

Acesse `http://localhost:3000`

---

## 📦 Deploy

O deploy é feito automaticamente via **Vercel** a cada push na branch `main`:

```bash
git add .
git commit -m "descrição da alteração"
git push origin main
# Vercel redeploy automático ✅
```

---

## 📊 Contexto de uso

- **Rede atendida:** 45+ empresas afiliadas (Rede My Broker)
- **Volume monitorado:** R$ 36M+ em transações acompanhadas
- **Equipe usuária:** Time de Contas a Receber — CSC Financeiro

---

## 🔒 Nota sobre os dados

Este repositório contém apenas o código da aplicação. Nenhum dado real de clientes, empresas ou transações financeiras está incluído. As variáveis de ambiente com credenciais de produção não são versionadas.

---

## 👤 Autor

**Gabriel Menezes**
Analista Financeiro Sênior — My Broker Imóveis
[LinkedIn](https://www.linkedin.com/in/gabrielmenezes-95a719224) · [gabrielmm008@gmail.com](mailto:gabrielmm008@gmail.com)
