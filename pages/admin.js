import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

const LOJAS_POR_GRUPO = {
  'Yasmin': [
    'PQ AMAZONIA','SETOR SUL','GARAVELO','ELDORADO','VILA BRASILIA',
    'APARECIDA','SENADOR CANEDO','BALNEARIO CAMBORIU','NOROESTE',
    'FLAMBOYANT','CUIABA','ARAES'
  ],
  'Ana Virginia': [
    'UBERLANDIA','SANTA MONICA','BH','CAMPINAS','JOAO PESSOA',
    'VITORIA','SAO JOSE DO RIO PRETO','RIBEIRAO PRETO','FLORIPA',
    'DIAMOND','JARDIM AMERICA','ALPHAMALL'
  ],
  'Laly': [
    'OFFICE','MARISTA','BUENA VISTA','AREIAO','SAO PAULO',
    'ANAPOLIS','SALVADOR','BUENO','SERRINHA','PRACA DO SOL'
  ],
};

export default function Admin({ sessao }) {
  const router = useRouter();
  const [perfil, setPerfil] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [userLojas, setUserLojas] = useState({}); // { user_id: [loja, ...] }
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nome: '', email: '', senha: '', role: 'editor' });
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [expandido, setExpandido] = useState(null); // user_id expandido para ver lojas
  const [novaLoja, setNovaLoja] = useState('');
  const [salvandoLojas, setSalvandoLojas] = useState(false);

  useEffect(() => { if (!sessao) return; carregarDados(); }, [sessao]);

  async function carregarDados() {
    setLoading(true);
    const { data: p } = await supabase.from('user_profiles').select('*').eq('id', sessao.user.id).single();
    if (!p || p.role !== 'admin') { router.replace('/'); return; }
    setPerfil(p);

    const { data: users } = await supabase.from('user_profiles').select('*').order('created_at', { ascending: true });
    setUsuarios(users || []);

    const { data: lojas } = await supabase.from('user_lojas').select('*');
    const map = {};
    (lojas || []).forEach(l => {
      if (!map[l.user_id]) map[l.user_id] = [];
      map[l.user_id].push(l.loja);
    });
    setUserLojas(map);
    setLoading(false);
  }

  async function criarUsuario(e) {
    e.preventDefault();
    setErro(''); setSucesso(''); setCriando(true);
    const { data, error } = await supabase.auth.admin.createUser({
      email: form.email, password: form.senha, email_confirm: true,
      user_metadata: { nome: form.nome, role: form.role },
    });
    if (error) {
      const { error: e2 } = await supabase.auth.signUp({
        email: form.email, password: form.senha,
        options: { data: { nome: form.nome, role: form.role } },
      });
      if (e2) { setErro('Erro: ' + e2.message); setCriando(false); return; }
    }
    await new Promise(r => setTimeout(r, 1500));
    const { data: allUsers } = await supabase.from('user_profiles').select('*').eq('email', form.email);
    if (allUsers && allUsers.length > 0) {
      await supabase.from('user_profiles').update({ nome: form.nome, role: form.role }).eq('email', form.email);
    }
    setSucesso(`Usuário ${form.nome} criado com sucesso!`);
    setForm({ nome: '', email: '', senha: '', role: 'editor' });
    setCriando(false);
    carregarDados();
  }

  async function toggleAtivo(u) {
    await supabase.from('user_profiles').update({ ativo: !u.ativo }).eq('id', u.id);
    carregarDados();
  }

  async function alterarRole(u, novoRole) {
    await supabase.from('user_profiles').update({ role: novoRole }).eq('id', u.id);
    carregarDados();
  }

  // Aplica grupo pré-definido a um usuário
  async function aplicarGrupo(userId, nomeGrupo) {
    setSalvandoLojas(true);
    const lojas = LOJAS_POR_GRUPO[nomeGrupo] || [];
    // Remove lojas existentes
    await supabase.from('user_lojas').delete().eq('user_id', userId);
    // Insere as do grupo
    if (lojas.length) {
      await supabase.from('user_lojas').insert(lojas.map(l => ({ user_id: userId, loja: l })));
    }
    setSalvandoLojas(false);
    carregarDados();
  }

  // Adiciona loja avulsa
  async function adicionarLoja(userId) {
    const l = novaLoja.trim().toUpperCase();
    if (!l) return;
    await supabase.from('user_lojas').upsert({ user_id: userId, loja: l });
    setNovaLoja('');
    carregarDados();
  }

  // Remove loja
  async function removerLoja(userId, loja) {
    await supabase.from('user_lojas').delete().eq('user_id', userId).eq('loja', loja);
    carregarDados();
  }

  if (loading) return (
    <div style={{ minHeight:'100vh',background:'#0D2654',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'DM Mono',monospace",fontSize:11,letterSpacing:3,textTransform:'uppercase',color:'rgba(255,255,255,.4)' }}>
      carregando...
    </div>
  );

  return (
    <>
      <Head>
        <title>Gestão de Usuários · My Broker</title>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="header">
        <div className="logo-area">
          <div className="logo-mark"><span>MB</span></div>
          <div>
            <div className="header-eyebrow">CSC Financeiro · Administração</div>
            <div className="header-name">Gestão de Usuários</div>
          </div>
        </div>
        <div className="header-actions">
          <button className="chip" onClick={() => router.push('/')}>← Voltar ao portal</button>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '32px auto', padding: '0 24px' }}>

        {/* CRIAR USUÁRIO */}
        <div className="admin-card">
          <div className="admin-card-eyebrow">Novo usuário</div>
          <div className="admin-card-title">Cadastrar membro da equipe</div>
          <form onSubmit={criarUsuario} className="admin-form">
            <div className="admin-fg">
              <label>Nome completo</label>
              <input type="text" required placeholder="Ex: Ana Lima" value={form.nome} onChange={e => setForm(f => ({...f, nome: e.target.value}))} />
            </div>
            <div className="admin-fg">
              <label>E-mail</label>
              <input type="email" required placeholder="ana@mybroker.com.br" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
            </div>
            <div className="admin-fg">
              <label>Senha inicial</label>
              <input type="password" required minLength={6} placeholder="Mínimo 6 caracteres" value={form.senha} onChange={e => setForm(f => ({...f, senha: e.target.value}))} />
            </div>
            <div className="admin-fg">
              <label>Perfil de acesso</label>
              <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))}>
                <option value="editor">Editor — edita pendências existentes</option>
                <option value="admin">Admin — acesso total</option>
              </select>
            </div>
            {erro && <div className="admin-erro">{erro}</div>}
            {sucesso && <div className="admin-sucesso">{sucesso}</div>}
            <button type="submit" className="btn btn-primary" disabled={criando}>
              {criando ? 'Criando...' : '+ Criar usuário'}
            </button>
          </form>
        </div>

        {/* LISTA DE USUÁRIOS + LOJAS */}
        <div className="admin-card" style={{ marginTop: 16 }}>
          <div className="admin-card-eyebrow">Equipe cadastrada</div>
          <div className="admin-card-title">Usuários e lojas vinculadas</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {usuarios.map(u => {
              const lojasDoUser = userLojas[u.id] || [];
              const isExpanded = expandido === u.id;
              const isMe = u.id === sessao.user.id;
              return (
                <div key={u.id} className="user-row-card" style={{ opacity: u.ativo ? 1 : .45 }}>
                  {/* Linha principal */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: '#1A2540' }}>{u.nome}</span>
                        {isMe && <span className="tag-voce">você</span>}
                        <span className={`role-badge ${u.role}`}>{u.role}</span>
                        <span className={u.ativo ? 'status-ativo' : 'status-inativo'}>{u.ativo ? 'ativo' : 'inativo'}</span>
                      </div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#8A96B0', marginTop: 2 }}>{u.email}</div>
                    </div>

                    {/* Contagem de lojas */}
                    <div style={{ textAlign: 'center', minWidth: 60 }}>
                      <div style={{ fontSize: 18, fontWeight: 600, color: lojasDoUser.length ? '#1E43F9' : '#8A96B0' }}>{lojasDoUser.length}</div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: 2, textTransform: 'uppercase', color: '#8A96B0' }}>lojas</div>
                    </div>

                    {/* Ações */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {!isMe && (
                        <>
                          <select className="role-sel" value={u.role} onChange={e => alterarRole(u, e.target.value)}>
                            <option value="editor">editor</option>
                            <option value="admin">admin</option>
                          </select>
                          <button className="row-btn" onClick={() => toggleAtivo(u)}>
                            {u.ativo ? 'desativar' : 'reativar'}
                          </button>
                        </>
                      )}
                      <button
                        className="row-btn"
                        style={{ borderColor: isExpanded ? '#1E43F9' : undefined, color: isExpanded ? '#1E43F9' : undefined }}
                        onClick={() => setExpandido(isExpanded ? null : u.id)}
                      >
                        {isExpanded ? '▲ fechar' : '▼ lojas'}
                      </button>
                    </div>
                  </div>

                  {/* Painel de lojas expandido */}
                  {isExpanded && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #DDE2EF' }}>

                      {/* Grupos pré-definidos */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: '#8A96B0', marginBottom: 8 }}>
                          Aplicar grupo pré-definido
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {Object.keys(LOJAS_POR_GRUPO).map(g => (
                            <button
                              key={g}
                              className="chip"
                              style={{ fontSize: 9, padding: '4px 10px' }}
                              onClick={() => aplicarGrupo(u.id, g)}
                              disabled={salvandoLojas}
                            >
                              {g} ({LOJAS_POR_GRUPO[g].length} lojas)
                            </button>
                          ))}
                          <button
                            className="row-btn"
                            style={{ color: '#E8334A', borderColor: '#E8334A' }}
                            onClick={() => aplicarGrupo(u.id, '__limpar__')}
                            disabled={salvandoLojas}
                          >
                            limpar todas
                          </button>
                        </div>
                      </div>

                      {/* Lojas atuais */}
                      {lojasDoUser.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: '#8A96B0', marginBottom: 8 }}>
                            Lojas vinculadas ({lojasDoUser.length})
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {lojasDoUser.sort().map(l => (
                              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#F4F6FB', border: '1px solid #DDE2EF', padding: '3px 8px', borderRadius: 4 }}>
                                <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#1A2540' }}>{l}</span>
                                <button
                                  onClick={() => removerLoja(u.id, l)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8A96B0', fontSize: 12, lineHeight: 1, padding: '0 2px' }}
                                  title="Remover"
                                >×</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Adicionar loja avulsa */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="text"
                          placeholder="Adicionar loja avulsa..."
                          value={novaLoja}
                          onChange={e => setNovaLoja(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && adicionarLoja(u.id)}
                          style={{ flex: 1, height: 32, padding: '0 10px', border: '1px solid #DDE2EF', fontSize: 12, fontFamily: "'DM Sans',sans-serif", color: '#1A2540' }}
                        />
                        <button className="btn btn-primary" style={{ padding: '0 14px', fontSize: 11 }} onClick={() => adicionarLoja(u.id)}>
                          + Adicionar
                        </button>
                      </div>

                      {/* Aviso se admin */}
                      {u.role === 'admin' && (
                        <div style={{ marginTop: 10, padding: '8px 12px', background: '#E6F1FB', borderLeft: '3px solid #1E43F9', fontSize: 11, color: '#185FA5' }}>
                          Usuário admin vê todas as pendências independente das lojas vinculadas.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* REFERÊNCIA DE GRUPOS */}
        <div className="admin-card" style={{ marginTop: 16 }}>
          <div className="admin-card-eyebrow">Referência</div>
          <div className="admin-card-title">Grupos pré-definidos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {Object.entries(LOJAS_POR_GRUPO).map(([nome, lojas]) => (
              <div key={nome}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#1E43F9', marginBottom: 8, fontWeight: 600 }}>
                  {nome} · {lojas.length} lojas
                </div>
                {lojas.map(l => (
                  <div key={l} style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: '#4A5578', padding: '2px 0', borderBottom: '1px solid #F4F6FB' }}>
                    {l}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

      </div>

      <style>{`
        .admin-card { background:#fff; border-top:4px solid #1E43F9; padding:24px; box-shadow:0 1px 4px rgba(0,0,0,.08); }
        .admin-card-eyebrow { font-family:'DM Mono',monospace; font-size:8px; letter-spacing:4px; text-transform:uppercase; color:#8A96B0; margin-bottom:4px; }
        .admin-card-title { font-family:'Bebas Neue',sans-serif; font-size:22px; letter-spacing:2px; color:#1A2540; margin-bottom:20px; }
        .admin-form { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .admin-fg { display:flex; flex-direction:column; gap:4px; }
        .admin-fg label { font-family:'DM Mono',monospace; font-size:8px; letter-spacing:3px; text-transform:uppercase; color:#8A96B0; }
        .admin-fg input,.admin-fg select { padding:9px 10px; border:1px solid #DDE2EF; border-bottom:2px solid #DDE2EF; font-size:12px; font-family:'DM Sans',sans-serif; color:#1A2540; }
        .admin-fg input:focus,.admin-fg select:focus { outline:none; border-color:#1E43F9; }
        .admin-erro { grid-column:1/-1; background:#FEE2E2; color:#991B1B; padding:10px; font-size:12px; border-left:3px solid #E8334A; }
        .admin-sucesso { grid-column:1/-1; background:#DCFCE7; color:#0A7A48; padding:10px; font-size:12px; border-left:3px solid #12B76A; }
        .admin-form .btn { grid-column:1/-1; padding:11px; font-size:11px; }
        .user-row-card { background:#fff; border:1px solid #DDE2EF; padding:14px 16px; border-radius:6px; }
        .tag-voce { display:inline-flex; padding:1px 6px; background:#E6F1FB; color:#1E43F9; font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; }
        .role-badge { display:inline-flex; padding:2px 8px; font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; font-weight:600; }
        .role-badge.admin { background:rgba(30,67,249,.1); color:#1E43F9; }
        .role-badge.editor { background:rgba(138,150,176,.12); color:#4A5578; }
        .role-sel { font-family:'DM Mono',monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; padding:3px 6px; border:1px solid #DDE2EF; color:#1A2540; background:#fff; cursor:pointer; }
        .status-ativo { font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; color:#0A7A48; }
        .status-inativo { font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; color:#8A96B0; }
        @media(max-width:600px){ .admin-form{grid-template-columns:1fr;} }
      `}</style>
    </>
  );
}
