# 3° CONVERSA - ENCONTRO DE CASAIS

Site de agendamento moderno e responsivo (desktop e celular) com:

- Next.js + React + Tailwind CSS
- Supabase em tempo real
- Bloqueio de agendamento duplicado por horário
- Deploy automático no GitHub Pages

## Regras Implementadas

- Datas disponíveis: `2026-08-22` e `2026-08-23`
- Horários: `07:00` até `20:00` com intervalo de 30 minutos
- Pausa de almoço automática: `12:00` e `12:30` indisponíveis
- Cada horário pode ser reservado apenas uma vez

## 1) Configurar Supabase

Crie um projeto no Supabase e execute o script:

- [supabase/schema.sql](supabase/schema.sql)

No painel do Supabase, habilite Realtime para a tabela `bookings`.

## 2) Variáveis de Ambiente

Crie um arquivo `.env.local` na raiz da pasta `web`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_PUBLISHABLE_KEY
```

Tambem funciona com `NEXT_PUBLIC_SUPABASE_ANON_KEY` por compatibilidade.

## 3) Rodar Localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## 4) Deploy no GitHub Pages (Grátis)

O workflow já está pronto em:

- [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)

No repositório GitHub, adicione os secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Se preferir, voce pode usar `NEXT_PUBLIC_SUPABASE_ANON_KEY` no lugar da publishable key.

Observacao: para GitHub Pages (host estatico), o fluxo principal usa cliente browser. Os helpers SSR em `utils/supabase/*` estao prontos para uso futuro em hospedagem com servidor (ex.: Vercel).

Depois:

1. Faça push para a branch `main`.
2. Em `Settings > Pages`, selecione `GitHub Actions` como source.
3. Aguarde o workflow finalizar.

O build usa `NEXT_PUBLIC_BASE_PATH=/<nome-do-repositorio>` automaticamente para funcionar no GitHub Pages.

## Scripts

- `npm run dev` - ambiente local
- `npm run lint` - validação de código
- `npm run build` - build estático para deploy
