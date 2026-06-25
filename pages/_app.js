import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [sessao, setSessao] = useState(undefined); // undefined = ainda carregando

  useEffect(() => {
    // Verifica sessão atual ao carregar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessao(session);
      if (!session && router.pathname !== '/login') {
        router.replace('/login');
      }
      if (session && router.pathname === '/login') {
        router.replace('/');
      }
    });

    // Escuta mudanças de sessão (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessao(session);
      if (!session) router.replace('/login');
      if (session && router.pathname === '/login') router.replace('/');
    });

    return () => subscription.unsubscribe();
  }, []);

  // Tela de carregamento enquanto verifica sessão
  if (sessao === undefined) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0D2654',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'DM Mono',monospace", fontSize: 11,
        letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,.4)'
      }}>
        carregando...
      </div>
    );
  }

  return <Component {...pageProps} sessao={sessao} />;
}
