# Shadow

[![ci](https://github.com/pach-boop/shadow/actions/workflows/ci.yml/badge.svg)](https://github.com/pach-boop/shadow/actions/workflows/ci.yml)

**Una IA completamente privada que te sigue como tu sombra — y no le responde a nadie más.**

Shadow es un compañero de IA open source y local-first. Hay exactamente **un chat**, y carga el **100% de tu contexto**: todo lo que le has contado, destilado en una memoria de largo plazo que nunca sale de tus manos. Como tu sombra: va a donde tú vas, conoce toda tu historia, y no le pertenece a nadie más que a ti — el modelo corre en tu dispositivo, cada palabra se cifra en reposo, y nada se guarda para nadie que no tenga la llave.

[Read this in English](./README.md)

> **Estado: pre-alpha.** Este repositorio contiene por ahora el diseño (README-first) y los registros de decisiones de arquitectura. El código llega hito por hito — ver el [roadmap](#roadmap).

## Por qué

La gente le cuenta a los asistentes de IA cosas que no le ha contado a nadie. Las empresas prohíben los asistentes de IA porque sus empleados les pegan datos confidenciales. Los dos problemas son el mismo problema: **las conversaciones con IA en la nube no tienen confidencialidad real.** Pueden retenerse — en 2025 una corte de EE.UU. ordenó a un proveedor grande preservar incluso los chats "borrados" — revisarse, citarse judicialmente, o alimentar pipelines de entrenamiento. Una política de privacidad es una promesa; Shadow reemplaza la promesa con arquitectura:

- **El modelo corre en tu dispositivo.** En el navegador vía WebGPU ([WebLLM](https://github.com/mlc-ai/web-llm)) sin instalar nada, o contra tu [Ollama](https://ollama.com) local. En modo local, nada sale de tu máquina — así que nada puede registrarse, retenerse, citarse ni usarse para entrenar.
- **Un chat, memoria total.** Sin carpetas, sin sesiones, sin volver a empezar. Embeddings locales recuperan tu historia relevante en cada turno, y el historial viejo se destila en una "memoria profunda" que puedes leer, editar o borrar. La continuidad *es* el producto.
- **Cifrado en reposo, borrado por llave.** Cada registro se cifra con AES-GCM usando una llave derivada de tu passphrase (Argon2id). No hay cuenta ni copia en servidor. "Borrar todo" destruye la llave — los bytes que queden son ruido.
- **La nube es opcional — y ciega.** Si activas respuestas más profundas (con tu propia API key), un modelo local primero redacta tu texto (nombres → roles, lugares → genéricos) y solo la versión abstracta se envía — el patrón de *privacy-conscious delegation* de [PAPILLON (NAACL 2025)](https://arxiv.org/abs/2410.17127), convertido en producto.
- **Cada llamada de inferencia se mide.** Tokens, modelo, latencia y costo por mensaje ($0 cuando es local), con export en formato [FOCUS](https://focus.finops.org/) — el router de privacidad es también un router de costos.

## Cómo fluye un mensaje

1. Desbloqueo: passphrase → Argon2id → desenvuelve la llave de datos (solo en memoria, se auto-bloquea).
2. Corre un check de seguridad local (léxico de crisis → se muestran recursos de ayuda; nunca se bloquea la escritura).
3. Memoria de largo plazo: embeddings locales (transformers.js) recuperan los momentos pasados más relevantes del almacén cifrado.
4. El router puntúa el mensaje por sensibilidad y complejidad, y elige camino:
   - **Local (default):** WebLLM en un worker, u Ollama en localhost. Streaming a la UI.
   - **Híbrido (opt-in + tu propia key):** redacción local → preview del payload exacto que saldría → llamada a nube → re-personalización local.
5. La llamada se mide (tokens, modelo, $, latencia) hacia el dashboard de costos y el export FOCUS.
6. Mensaje, respuesta y embeddings se cifran con AES-GCM y persisten en IndexedDB. Periódicamente, el modelo local destila el historial viejo en la memoria profunda editable y borrable.

## Para equipos

La misma garantía importa en el trabajo. Los empleados ya pegan cifras, código y estrategia confidencial en chats de IA — normalmente contra la política interna, porque las herramientas son útiles. Con Shadow, un equipo puede usar IA sobre material confidencial con la garantía hecha por arquitectura, no por contrato: en modo local nada sale de la máquina del empleado, nada llega a servidores de nadie, y nada puede entrenar los modelos de nadie. Un modo solo-local aplicable por política para organizaciones está en el roadmap.

## Lo que Shadow NO es

Shadow es un compañero privado para pensar y reflexionar. **No es terapia, no es consejo médico y no es un servicio de crisis**, y no diagnostica ni trata nada. Si la estás pasando mal, busca ayuda: **Línea de la Vida 800 911 2000** (MX) · **988** (EE.UU.) · tus servicios de emergencia locales. La app mantiene estos recursos visibles en todo momento.

## Roadmap

| Hito | Entregable | Estado |
|---|---|---|
| M0 | Diseño README-first + registros de decisiones de arquitectura | ✅ |
| M1 | Chat local: UI React + adapter de Ollama, streaming | — |
| M2 | Cifrado at-rest + borrado criptográfico + export cifrado | — |
| M3 | La memoria: RAG local sobre historial cifrado + vista de memoria profunda | — |
| M4 | Router de privacidad/costo + medición por mensaje + export FOCUS | — |
| M5 | Recursos de crisis, packs de reflexión guiada (journaling, shadow work — es/en), WebLLM en navegador | — |
| M6 | Release v0.1.0 + demo viva en GitHub Pages | — |

## Trabajo relacionado

Shadow compone ideas que ya existen por separado; ninguna de las piezas de abajo las combina:

- Odysseus, [Jan](https://github.com/janhq/jan), Open WebUI — excelentes workspaces de IA self-hosted que instalas y corres en tu propio hardware. Shadow es la forma opuesta: cero instalación, un chat en una pestaña del navegador, cifrado en reposo.
- [Memex](https://github.com/memex-lab/memex) — journal de IA open source local-first. Guarda plaintext local y envía prompts crudos al proveedor que configures; sin cifrado at-rest, sin capa de redacción, sin telemetría de costos.
- [PAPILLON](https://arxiv.org/abs/2410.17127) — el prior académico de nuestro router; un pipeline de investigación, no un producto.
- [RouteLLM](https://github.com/lm-sys/RouteLLM), NotDiamond — routers de LLM que optimizan costo/calidad; la privacidad no es dimensión de ruteo y no hay export en estándar de facturación.
- [Standard Notes](https://standardnotes.com) — el referente de cifrado honesto del lado del cliente en una app open source (sin IA).

## Stack

Monorepo TypeScript: `packages/core` (almacenamiento, cripto, memoria, router, medición — sin UI) + `apps/web` (PWA en React, desplegable como sitio estático). Inferencia local por adapters intercambiables (WebLLM / Ollama / nube BYOK). Embeddings vía transformers.js. WebCrypto para AES-GCM y derivación de llaves. Las decisiones y sus porqués viven en [`docs/adr/`](./docs/adr/).

## Transparencia de IA

Shadow se desarrolla con asistencia de IA. No se mergea nada que el mantenedor no entienda por completo y pueda defender. Las decisiones de diseño se registran como ADRs con sus trade-offs.

## Licencia

[Apache-2.0](./LICENSE)
