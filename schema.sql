-- ============================================================
-- Schema do banco de dados: Central de Pendências My Broker
-- Execute este script no SQL Editor do Supabase
-- ============================================================

create table if not exists pendencias (
  id text primary key,
  loja text default '',
  pagador text default '',
  empreendimento text default '',
  proposta text default '',
  data_receb text default '',
  valor numeric default 0,
  tipo text default 'Documentação',
  status text default 'Pendente',
  responsavel text default '',
  acao text default '',
  obs text default '',
  historico jsonb default '[]'::jsonb,
  origem text default 'manual',
  confianca text default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Atualiza updated_at automaticamente a cada alteração
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_pendencias_updated on pendencias;
create trigger trg_pendencias_updated
before update on pendencias
for each row execute function set_updated_at();

-- Habilita Row Level Security e permite acesso público (sem login),
-- já que o requisito é "qualquer pessoa com o link, sem senha".
alter table pendencias enable row level security;

drop policy if exists "Acesso publico total" on pendencias;
create policy "Acesso publico total"
on pendencias
for all
using (true)
with check (true);
