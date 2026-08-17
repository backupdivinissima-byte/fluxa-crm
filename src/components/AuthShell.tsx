import type { ReactNode } from 'react';
import fluxaIcon from '../assets/fluxa-icon.svg';

interface Props {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
  rodape: ReactNode;
}

/** Tela dividida (estilo Bling/Ewdesa) usada no Login e no Cadastro da
 * empresa: painel colorido com a marca Fluxa CRM à esquerda, formulário à
 * direita. Mesmo padrão visual já usado no Fluxa ERP. */
export default function AuthShell({ titulo, subtitulo, children, rodape }: Props) {
  return (
    <div className="min-h-screen flex bg-surface">
      <div className="hidden lg:flex lg:w-[46%] xl:w-[42%] relative overflow-hidden bg-gradient-to-br from-teal-600 via-teal-500 to-blue-700 text-white flex-col justify-between p-12">
        <DecoracaoFacetas />

        <div className="relative flex items-center gap-3">
          <img src={fluxaIcon} alt="Fluxa CRM" className="w-10 h-10 rounded-xl ring-2 ring-white/40 shadow-lg" />
          <span className="text-2xl font-extrabold tracking-tight">Fluxa CRM</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-extrabold leading-tight mb-4">Cada cliente, no momento certo do funil.</h2>
          <p className="text-white/80 text-sm leading-relaxed">
            Funil de vendas, clientes, vendedores e metas — organizados por empresa, feito pra equipes de
            vendas acompanharem tudo em um só lugar.
          </p>
        </div>

        <div className="relative text-xs text-white/60">Fluxa CRM · Todos os direitos reservados</div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-6 lg:hidden">
            <img src={fluxaIcon} alt="Fluxa CRM" className="w-14 h-14 mb-3" />
          </div>
          <h1 className="text-xl font-extrabold text-ink text-center lg:text-left">{titulo}</h1>
          <p className="text-sm text-ink-soft text-center lg:text-left mt-1 mb-8">{subtitulo}</p>

          {children}

          <p className="text-center text-sm text-ink-soft mt-5">{rodape}</p>
        </div>
      </div>
    </div>
  );
}

/** Padrão geométrico sutil (facetas de gema), só decorativo. */
function DecoracaoFacetas() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.15] pointer-events-none"
      viewBox="0 0 400 800"
      fill="none"
      aria-hidden="true"
    >
      <polygon points="40,60 140,20 180,120 90,160" stroke="white" strokeWidth="1.5" />
      <polygon points="220,300 320,260 360,360 260,400" stroke="white" strokeWidth="1.5" />
      <polygon points="60,500 160,460 200,560 100,600" stroke="white" strokeWidth="1.5" />
      <circle cx="330" cy="140" r="60" stroke="white" strokeWidth="1" />
      <circle cx="80" cy="650" r="90" stroke="white" strokeWidth="1" />
      <polygon points="250,620 300,600 330,650 290,690 250,670" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}
