import { useState } from 'react';

interface Props {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}

/** Campo de senha com botão de "olho" pra mostrar/ocultar o texto digitado —
 * evita erro de digitação, sobretudo em campos de confirmação. */
export default function CampoSenha({ label, value, onChange, required, minLength, autoComplete }: Props) {
  const [visivel, setVisivel] = useState(false);

  return (
    <div>
      <label className="block text-xs font-bold text-ink-soft uppercase tracking-wide mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={visivel ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-line px-3.5 py-2.5 pr-11 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          tabIndex={-1}
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink"
        >
          {visivel ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.4 5.5A10.4 10.4 0 0 1 12 5c5 0 9 4 10.5 7-.6 1.1-1.4 2.2-2.4 3.2M6.3 6.9C4.4 8.2 3 9.9 1.5 12c1.5 3 5.5 7 10.5 7 1.3 0 2.5-.2 3.7-.6" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
