import { useState } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setErro('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(false);
    if (error) {
      setErro('E-mail ou senha incorretos. Tente novamente.');
    }
    // Se login ok, o _app.js detecta a sessão e redireciona automaticamente
  }

  return (
    <>
      <Head>
        <title>Login · My Broker CSC Financeiro</title>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>
      <div className="login-bg">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-mark"><span>MB</span></div>
          </div>
          <div className="login-eyebrow">CSC Financeiro · Contas a Receber</div>
          <div className="login-title">Central de Pendências</div>
          <form onSubmit={handleLogin} className="login-form">
            <div className="login-fg">
              <label>E-mail</label>
              <input
                type="email" required autoFocus
                placeholder="seu@email.com.br"
                value={email} onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="login-fg">
              <label>Senha</label>
              <input
                type="password" required
                placeholder="••••••••"
                value={senha} onChange={e => setSenha(e.target.value)}
              />
            </div>
            {erro && <div className="login-erro">{erro}</div>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
          <div className="login-footer">My Broker Imóveis · Acesso restrito</div>
        </div>
      </div>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; }
        .login-bg {
          min-height: 100vh;
          background: #0D2654;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .login-card {
          background: #fff;
          width: 100%; max-width: 380px;
          padding: 36px 32px 28px;
          border-top: 4px solid #1E43F9;
          box-shadow: 0 24px 64px rgba(0,0,0,.35);
        }
        .login-logo { margin-bottom: 20px; }
        .login-mark {
          width: 40px; height: 40px; background: #1E43F9;
          display: inline-flex; align-items: center; justify-content: center;
          clip-path: polygon(0 0,100% 0,100% 75%,50% 100%,0 75%);
        }
        .login-mark span { font-family: 'Bebas Neue',sans-serif; color: #fff; font-size: 17px; letter-spacing: 1px; }
        .login-eyebrow { font-family: 'DM Mono',monospace; font-size: 8px; letter-spacing: 4px; text-transform: uppercase; color: #8A96B0; margin-bottom: 4px; }
        .login-title { font-family: 'Bebas Neue',sans-serif; font-size: 26px; letter-spacing: 2px; color: #1A2540; margin-bottom: 28px; }
        .login-form { display: flex; flex-direction: column; gap: 14px; }
        .login-fg { display: flex; flex-direction: column; gap: 5px; }
        .login-fg label { font-family: 'DM Mono',monospace; font-size: 8px; letter-spacing: 3px; text-transform: uppercase; color: #8A96B0; }
        .login-fg input { padding: 10px 12px; border: 1px solid #DDE2EF; border-bottom: 2px solid #DDE2EF; font-size: 13px; font-family: 'DM Sans',sans-serif; color: #1A2540; transition: border-color .15s; }
        .login-fg input:focus { outline: none; border-color: #1E43F9; border-bottom-color: #1E43F9; }
        .login-erro { background: #FEE2E2; color: #991B1B; padding: 10px 12px; font-size: 12px; border-left: 3px solid #E8334A; }
        .login-btn { margin-top: 4px; padding: 12px; background: #1E43F9; color: #fff; border: none; font-size: 12px; font-weight: 600; font-family: 'DM Sans',sans-serif; letter-spacing: .5px; cursor: pointer; transition: background .15s; }
        .login-btn:hover { background: #1535D4; }
        .login-btn:disabled { opacity: .6; cursor: not-allowed; }
        .login-footer { margin-top: 24px; font-family: 'DM Mono',monospace; font-size: 8px; letter-spacing: 2px; text-transform: uppercase; color: #8A96B0; text-align: center; }
      `}</style>
    </>
  );
}
