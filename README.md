# Programa_agendamento

Sistema de agendamento para o evento **3° Conversa - Encontro de Casais**, com interface moderna e responsiva, reservas em tempo real e fluxo sem login/senha.

## Visão Geral

O projeto foi estruturado com a aplicação Next.js dentro da pasta `web/`.

Principais funcionalidades:

- Agendamento por data e horário
- Bloqueio de horário já reservado
- Limite de **1 reserva ativa por telefone**
- Consulta de reserva por telefone
- Cancelamento e remarcação
- Atualização em tempo real com Supabase
- Deploy automatizado no GitHub Pages

## Tecnologias

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS v4
- Supabase (Database + Realtime)

## Estrutura do Projeto

```text
Programa_agendamento/
├─ README.md
└─ web/
	├─ app/
	├─ lib/
	├─ public/
	├─ supabase/
	│  └─ schema.sql
	├─ .github/workflows/
	├─ package.json
	└─ README.md
```

## Pré-requisitos

- Node.js 20+
- npm
- Conta no Supabase

## Configuração Rápida

### 1. Instalar dependências

Na raiz do projeto:

```bash
npm --prefix web install
```

### 2. Configurar banco no Supabase

1. Crie um projeto no Supabase.
2. Execute o SQL de [web/supabase/schema.sql](web/supabase/schema.sql).
3. Habilite Realtime para a tabela `bookings`.

### 3. Criar variáveis de ambiente

Crie o arquivo `web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_PUBLISHABLE_KEY
NEXT_PUBLIC_ADMIN_USERNAME_HASH=HASH_SHA256_DO_USUARIO_ADMIN
NEXT_PUBLIC_ADMIN_PASSWORD_HASH=HASH_SHA256_DA_SENHA_ADMIN
```

Compatibilidade: também aceita `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Rodando Localmente

```bash
npm --prefix web run dev
```

Acesse: `http://localhost:3000`

Se houver instabilidade de hot reload no Windows:

```bash
npm --prefix web run dev:poll
```

## Scripts Úteis

```bash
npm --prefix web run dev
npm --prefix web run dev:poll
npm --prefix web run lint
npm --prefix web run build
```

## Deploy no GitHub Pages

O workflow já está pronto em:

- [web/.github/workflows/deploy-pages.yml](web/.github/workflows/deploy-pages.yml)

Secrets necessários no GitHub:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_ADMIN_USERNAME_HASH`
- `NEXT_PUBLIC_ADMIN_PASSWORD_HASH`

Para gerar os hashes SHA-256 do usuário e senha no PowerShell:

```powershell
$value = "seu-valor"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
($hash | ForEach-Object { $_.ToString("x2") }) -join ""
```

Passos:

1. Faça push para `main`.
2. Em **Settings > Pages**, selecione **GitHub Actions**.
3. Aguarde o workflow finalizar.

## Regras de Negócio Implementadas

- Datas disponíveis: 22/08/2026 e 23/08/2026
- Horários de 30 em 30 minutos
- Pausa de almoço automática no sábado (12:00 e 12:30)
- 1 reserva ativa por telefone
- 1 reserva por horário
- Cancelamento libera o horário

## Documentação da Aplicação

Detalhes técnicos e fluxo da aplicação