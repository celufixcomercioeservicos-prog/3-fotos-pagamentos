const PACOTES = {
  video1: 29.90,
  video3: 79.90,
  video5: 129.90,
  video10: 229.90
};

const SITE = "https://3-fotos-studio.celufixcomercioeservicos.workers.dev";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin === SITE ? SITE : "null",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    const resposta = (dados, status = 200) =>
      new Response(JSON.stringify(dados), { status, headers });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (origin && origin !== SITE) {
      return resposta({ erro: "Origem não autorizada." }, 403);
    }

    if (!env.MP_ACCESS_TOKEN) {
      return resposta({ erro: "Token do Mercado Pago não configurado." }, 500);
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return resposta({
        projeto: "3 Fotos Studio",
        servidor: "ativo"
      });
    }

    if (request.method === "POST" && url.pathname === "/criar-pix") {
      try {
        const body = await request.json();
        const valor = PACOTES[body.pacote];
        const email = String(body.email || "").trim();

        if (!valor) {
          return resposta({ erro: "Pacote inválido." }, 400);
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return resposta({ erro: "E-mail inválido." }, 400);
        }

        const idempotencia = crypto.randomUUID();

        const pagamento = await fetch(
          "https://api.mercadopago.com/v1/orders",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
              "X-Idempotency-Key": idempotencia
            },
            body: JSON.stringify({
              type: "online",
              total_amount: valor.toFixed(2),
              external_reference: "3fotos-" + idempotencia,
              processing_mode: "automatic",
              transactions: {
                payments: [{
                  amount: valor.toFixed(2),
                  payment_method: {
                    id: "pix",
                    type: "bank_transfer"
                  }
                }]
              },
              payer: { email }
            })
          }
        );

        const dados = await pagamento.json();

        if (!pagamento.ok) {
          return resposta({
            erro: "Falha ao criar Pix.",
            detalhe: dados
          }, pagamento.status);
        }

        const metodo = dados.transactions?.payments?.[0]?.payment_method || {};

        return resposta({
          pedido: dados.id,
          status: dados.status,
          valor,
          pix_copia_cola: metodo.qr_code || null,
          qr_code_base64: metodo.qr_code_base64 || null,
          link_pagamento: metodo.ticket_url || null
        }, 201);

      } catch (erro) {
        return resposta({ erro: erro.message }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const id = url.searchParams.get("order_id");

      if (!id) {
        return resposta({ erro: "Informe o order_id." }, 400);
      }

      const consulta = await fetch(
        `https://api.mercadopago.com/v1/orders/${encodeURIComponent(id)}`,
        {
          headers: {
            Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`
          }
        }
      );

      const dados = await consulta.json();

      return resposta({
        pedido: dados.id,
        status: dados.status || "indefinido",
        detalhe: dados.status_detail || null
      }, consulta.status);
    }

    return resposta({ erro: "Rota não encontrada." }, 404);
  }
};
