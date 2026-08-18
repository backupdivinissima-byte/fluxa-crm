import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Domínio próprio (fluxagestaoevendas.com.br) serve o site na raiz —
  // por isso a base mudou de '/fluxa-crm/' pra '/'.
  base: '/',
  plugins: [react(), tailwindcss()],
})
