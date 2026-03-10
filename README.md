# Sistema de Consulta de Haberes Docentes (Admin)

Interfaz administrativa para cargar una nómina de CUILs (TXT), seleccionar uno o más períodos (YYYY-MM), consultar haberes a una API y generar PDFs en el navegador.

## Stack

- **React + TypeScript (Vite)**
- **Tailwind CSS**
- **Axios** (cliente HTTP con `apiClient` + mapeo consistente de errores a `AppError`)
- **pdfmake** (preview + descarga)
- **Vitest** (tests mínimos)
- **ESLint + Prettier** (calidad y formato)

## Scripts

> En Windows con PowerShell restringido, usá `npm.cmd` (ej. `npm.cmd run dev`).

- **dev**: `npm run dev`
- **build**: `npm run build`
- **test**: `npm run test`
- **lint**: `npm run lint`
- **format**: `npm run format`

## Configuración (.env)

Copiá `env.example` a `.env` y ajustá:

- **`VITE_API_BASE_URL`**: base URL del backend (si está vacío, se usa **mock** de 1s).
- **`VITE_PAYROLL_PATH`**: path del endpoint (default `/payroll`).
- **`VITE_CHEQUES_PROXY_TARGET`**: target del proxy de Vite para endpoints `/wsstestsigue/cheques/*` (dev). En prod, usar reverse proxy/backend.

## Arquitectura (src/)

- **`components/`**: UI reusable (`ui/`) + upload/filtros/resultados/pdf (sin lógica de negocio).
- **`features/payroll/`**: estado y orquestación (Provider + `useReducer` + página).
- **`services/`**: `apiClient` (Axios) + `fetchPayroll` (real/mock).
- **`utils/`**: parsing TXT, normalización de respuesta, agrupaciones, helpers de CUIL/período.
- **`types/`**: modelos (`PayrollItem`, `NormalizedPayroll`, `AppError`, etc.).
- **`pdf/`**: builders pdfmake + render (blob URL, download).
- **`fixtures/`**: fixtures para tests y validación del normalizador.

## Flujo principal (MVP)

1. `CuilUploader` lee el `.txt` y usa `parseCuilTxtDetailed()` para **normalizar/deduplicar/validar**.
2. `PeriodSelector` permite cargar múltiples períodos `YYYY-MM`.
3. Al “Consultar”, `fetchPayroll(cuils, periodos)` llama a la API (o mock) y `normalizeResponse()` adapta el contrato a un modelo estable.
4. La UI permite agrupar **por Agente** o **por Período**, renderiza tablas y genera PDF con `buildPdfByAgent()` / `buildPdfByPeriod()`.

## Tests

- `src/utils/txtParser.test.ts`
- `src/utils/grouping.test.ts`
- `src/utils/normalizeResponse.test.ts`

## Dónde ajustar el contrato real

- `src/utils/normalizeResponse.ts`: mapeo tolerante de keys y coerciones.
- `src/services/payrollService.ts`: endpoint via `VITE_API_BASE_URL` + `VITE_PAYROLL_PATH`.
- `src/fixtures/payrollResponseFixture.ts`: ejemplo para evolucionar el normalizador.
