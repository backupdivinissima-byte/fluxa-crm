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
