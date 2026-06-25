import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Admin({ sessao }) {
  const router = useRouter();
  const [perfil, setPerfil] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nome: '', email: '', senha: '', role: 'editor' });
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  useEffect(() => {
    if (!sessao) return;
    carregarDados();
  }, [sessao]);

  async function carregarDados() {
    setLoading(true);
    // Busca perfil do usuário logado
    const { data: p } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', sessao.user.id)
      .single();

    if (!p || p.role !== 'admin') {
      router.replace('/');
      return;
    }
    setPerfil(p);

    // Busca todos os usuários
    const { data: users } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    setUsuarios(users || []);
    setLoading(false);
  }

  async function criarUsuario(e) {
    e.preventDefault();
    setErro(''); setSucesso(''); setCriando(true);

    // Cria usuário via Supabase Admin API (service role) — aqui usamos a função RPC
    const { data, error } = await supabase.auth.admin.createUser({
      email: form.email,
      password: form.senha,
      email_confirm: true,
      user_metadata: { nome: form.nome, role: form.role },
    });

    if (error) {
      // Fallback: cria via signUp normal (sem admin API)
      const { data: d2, error: e2 } = await supabase.auth.signUp({
        email: form.email,
        password: form.senha,
        options: { data: { nome: form.nome, role: form.role } },
      });
      if (e2) { setErro('Erro ao criar usuário: ' + e2.message); setCriando(false); return; }
    }

    // Aguarda trigger criar o perfil e depois atualiza o role manualmente se necessário
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

      <div style={{ maxWidth: 900, margin: '32px auto', padding: '0 24px' }}>

        {/* ── CRIAR USUÁRIO ── */}
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

        {/* ── LISTA DE USUÁRIOS ── */}
        <div className="admin-card" style={{ marginTop: 16 }}>
          <div className="admin-card-eyebrow">Equipe cadastrada</div>
          <div className="admin-card-title">Usuários ativos</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} style={{ opacity: u.ativo ? 1 : .45 }}>
                  <td style={{ fontWeight: 600 }}>
                    {u.nome}
                    {u.id === sessao.user.id && <span className="tag-voce">você</span>}
                  </td>
                  <td style={{ fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{u.email}</td>
                  <td>
                    {u.id === sessao.user.id ? (
                      <span className="role-badge admin">admin</span>
                    ) : (
                      <select
                        className="role-sel"
                        value={u.role}
                        onChange={e => alterarRole(u, e.target.value)}
                      >
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <span className={u.ativo ? 'status-ativo' : 'status-inativo'}>
                      {u.ativo ? 'ativo' : 'inativo'}
                    </span>
                  </td>
                  <td>
                    {u.id !== sessao.user.id && (
                      <button className="row-btn" onClick={() => toggleAtivo(u)}>
                        {u.ativo ? 'desativar' : 'reativar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        .admin-table { width:100%; border-collapse:collapse; margin-top:12px; font-size:12px; }
        .admin-table th { font-family:'DM Mono',monospace; font-size:8px; letter-spacing:3px; text-transform:uppercase; color:#8A96B0; padding:8px 10px; border-bottom:2px solid #DDE2EF; text-align:left; }
        .admin-table td { padding:10px 10px; border-bottom:1px solid #DDE2EF; color:#1A2540; }
        .tag-voce { display:inline-flex; margin-left:6px; padding:1px 6px; background:#E6F1FB; color:#1E43F9; font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; }
        .role-badge { display:inline-flex; padding:2px 8px; font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; font-weight:600; }
        .role-badge.admin { background:rgba(30,67,249,.1); color:#1E43F9; }
        .role-sel { font-family:'DM Mono',monospace; font-size:9px; letter-spacing:2px; text-transform:uppercase; padding:3px 6px; border:1px solid #DDE2EF; color:#1A2540; background:#fff; cursor:pointer; }
        .status-ativo { font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; color:#0A7A48; }
        .status-inativo { font-family:'DM Mono',monospace; font-size:8px; letter-spacing:2px; text-transform:uppercase; color:#8A96B0; }
        @media(max-width:600px){ .admin-form{grid-template-columns:1fr;} }
      `}</style>
    </>
  );
}
