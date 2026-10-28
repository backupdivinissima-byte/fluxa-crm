import type { ReactNode } from 'react';

/** Ícones em traço fino (currentColor) usados tanto na nav do sistema quanto
 * nos títulos de cada página — mesmo estilo dos ícones da página
 * institucional, no lugar dos emojis antigos. Centralizados aqui pra manter
 * o mesmo desenho em todo canto que hoje mostra "CRM", "Clientes" etc. */
export function NavIcon({ children, className = 'w-[18px] h-[18px]' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0`}
    >
      {children}
    </svg>
  );
}

export function IconDashboard(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.3" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.3" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.3" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.3" />
    </NavIcon>
  );
}

export function IconCrm(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M4 5h16l-6.2 7.2v6.3l-3.6 1.8v-8.1L4 5z" />
    </NavIcon>
  );
}

export function IconClientes(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <circle cx="9" cy="8.2" r="3" />
      <path d="M3.3 20c.3-3.6 2.8-6 5.7-6s5.4 2.4 5.7 6" />
      <circle cx="17" cy="9.2" r="2.2" />
      <path d="M14.6 14.4c2.3.5 4 2.6 4.2 5.6" />
    </NavIcon>
  );
}

export function IconVendedores(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6.5 15.5c.4-1.6 1.5-2.5 2.5-2.5s2.1.9 2.5 2.5" />
      <path d="M14.5 10h4M14.5 13h4" />
    </NavIcon>
  );
}

export function IconMetas(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <circle cx="12" cy="12" r="7.8" />
      <circle cx="12" cy="12" r="4.3" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </NavIcon>
  );
}

export function IconLinks(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M8 16 5.8 13.8a3.5 3.5 0 0 1 0-5l1-1a3.5 3.5 0 0 1 5 0L14 10" />
      <path d="M16 8l2.2 2.2a3.5 3.5 0 0 1 0 5l-1 1a3.5 3.5 0 0 1-5 0L10 14" />
      <path d="M9.5 14.5 14.5 9.5" />
    </NavIcon>
  );
}

export function IconImportar(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16.3 8.2 4.5 4.5 0 0 1 16.5 18H7Z" />
      <path d="M12 10.5v6M9.5 13l2.5-2.5 2.5 2.5" />
    </NavIcon>
  );
}

export function IconOrcamento(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M6 3.5h9l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3.5V7h3.5" />
      <path d="M12 12v5M9.5 14.5h5" />
    </NavIcon>
  );
}

// Ícone de chave no mesmo traço fino dos demais (substitui o emoji 🔑), pra
// usar tanto solto (cor herdada) quanto dentro do quadrado com gradiente
// teal→azul, igual ao selo da logo.
export function IconChave(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <circle cx="8" cy="15" r="3.6" />
      <path d="M10.4 12.6 18.5 4.5" />
      <path d="M15.5 7.5l2 2M18 5l2 2" />
    </NavIcon>
  );
}

// Ícone do item de nav "Marketing" (megafone) — módulo com as abas Meta,
// Live e Análise Marketing.
export function IconMarketing(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H7l3.2 4.3c.5.7 1.6.3 1.6-.5V6.2c0-.8-1.1-1.2-1.6-.5L7 10H5.5A1.5 1.5 0 0 0 4 10Z" />
      <path d="M17 8.5c1.2 1 1.2 6 0 7" />
      <path d="M14.5 10.2c.6.5.6 3.1 0 3.6" />
    </NavIcon>
  );
}

// Ícone da aba "Meta" (gráfico de anúncios/resultados).
export function IconMetaAds(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M4 19V10M9.5 19V5M15 19v-7M20 19v-3" />
      <path d="M3.5 19.5h17" />
    </NavIcon>
  );
}

// Ícone da aba "Live" (câmera/transmissão ao vivo).
export function IconLive(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="3.5" y="7" width="12" height="10" rx="2" />
      <path d="M15.5 10.3 20.5 7v10l-5-3.3" />
      <circle cx="6.7" cy="10.2" r="0.9" fill="currentColor" stroke="none" />
    </NavIcon>
  );
}

export function IconInstagram(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.8" cy="7.3" r="0.9" fill="currentColor" stroke="none" />
    </NavIcon>
  );
}

export function IconChat(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16.5h-7l-4 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z" />
      <path d="M8 10h8M8 13h5" />
    </NavIcon>
  );
}

export function IconEstoque(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16V8Z" />
      <path d="M3.5 8 12 12.5 20.5 8M12 12.5v8" />
    </NavIcon>
  );
}

export function IconErpInicio(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9.5h12V10M10 19.5v-5h4v5" />
    </NavIcon>
  );
}

export function IconErpVendas(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M3.5 4.5h2.2l2 10.5h9.6l1.8-7.5H7" />
      <circle cx="9.5" cy="19" r="1.3" />
      <circle cx="16.5" cy="19" r="1.3" />
    </NavIcon>
  );
}

export function IconErpFinanceiro(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.4.7-2.4 1.8 0 2.4 5 1.2 5 3.6 0 1.1-1.1 1.8-2.6 1.8-1.1 0-2.1-.4-2.6-1.3M12 6.5V8m0 8v1.5" />
    </NavIcon>
  );
}

export function IconErpCadastros(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2v-13Z" />
      <path d="M5 17.5a2 2 0 0 1 2-2h11M9 8.5h5M9 11.5h5" />
    </NavIcon>
  );
}

export function IconErpIntegracoes(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M9 4v4M15 4v4M7 8h10v3.5a5 5 0 0 1-10 0V8Z" />
      <path d="M12 16.5V20" />
    </NavIcon>
  );
}

export function IconAgenda(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </NavIcon>
  );
}

export function IconProdutoMenu(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9-8-8Z" />
      <circle cx="8.5" cy="8.5" r="1.3" />
    </NavIcon>
  );
}

export function IconAuditoria(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M8.5 12l2 2 4-4M8.5 17h7" />
    </NavIcon>
  );
}

export function IconCategoria(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </NavIcon>
  );
}
export function IconVariacoes(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z" /><path d="m3 12 9 4.5 9-4.5M3 16l9 4.5 9-4.5" />
    </NavIcon>
  );
}
export function IconGrupoProduto(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7Z" />
    </NavIcon>
  );
}
export function IconMarca(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.250 4.100 1 5.800L12 16.800 6.750 19.600l1-5.800L3.500 9.700l5.900-.9L12 3.500Z" />
    </NavIcon>
  );
}
export function IconTabelaPreco(props: { className?: string }) {
  return (
    <NavIcon {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M9 10v9M14 13.500h3.500M14 16h3.500" />
    </NavIcon>
  );
}
