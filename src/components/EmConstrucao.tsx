interface Props {
  titulo: string;
  icone: string;
}

/** Placeholder pras telas que ainda vão ser construídas (CRM, Clientes,
 * Vendedores, Metas, Links, Importar) — só pra deixar a navegação completa
 * e utilizável enquanto cada uma é implementada. */
export default function EmConstrucao({ titulo, icone }: Props) {
  return (
    <div className="p-8 w-full">
      <div className="section-title flex items-center gap-2 text-base font-extrabold text-ink mb-4">
        <span className="text-xl">{icone}</span> {titulo}
      </div>
      <div className="bg-white border border-line rounded-2xl p-10 text-center max-w-xl">
        <div className="text-3xl mb-3">🚧</div>
        <p className="text-sm text-ink-soft">
          Essa tela ainda está sendo reconstruída para o Fluxa CRM. Em breve com a mesma funcionalidade de hoje.
        </p>
      </div>
    </div>
  );
}
