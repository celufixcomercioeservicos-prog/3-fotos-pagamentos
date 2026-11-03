
export default {
  async fetch(request, env) {
    const SITE = "https://3-fotos-studio.celufixcomercioeservicos.workers.dev";
    const origin = request.headers.get("Origin");

    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": SITE,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (origin && origin !== SITE) {
      return json({ erro: "Site não autorizado." }, 403);
    }

    if (!env.MP_ACCESS_TOKEN) {
      return json({ erro: "Access Token não configurado no servidor." }, 500);
    }

    const url = new URL(request.url);

    // CRIAR PIX
    if (request.method === "POST" && url.pathname === "/criar-pix") {
      try {
        const body = await request.json();

        const pacotes = {
          video1: 29.90,
          video3: 79.90,
          video5: 129.90,
          video10: 229.90
        };

        const valor = pacotes[body.pacote];
        const email = String(body.email || "").trim();

        if (!valor) {
          return json({ erro: "Pacote inválido." }, 400);
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ erro: "E-mail inválido." }, 400);
        }

        const idempotencia = crypto.randomUUID();

        const resposta = await fetch(
          "https://api.mercadopago.com/v1/orders",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`,
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
              payer: {
                email: email
              }
            })
          }
        );

        const dados = await resposta.json();

        if (!resposta.ok) {
          return json({
            erro: "Mercado Pago recusou a criação do Pix.",
            detalhe: dados
          }, resposta.status);
        }

        const pagamento = dados.transactions?.payments?.[0];
        const metodo = pagamento?.payment_method || {};

        return json({
          pedido: dados.id,
          order_id: dados.id,
          valor: valor,
          status: dados.status,
          status_pagamento: pagamento?.status,
          pix_copia_cola: metodo.qr_code || null,
          qr_code_base64: metodo.qr_code_base64 || null,
          link_pagamento: metodo.ticket_url || null
        }, 201);

      } catch (erro) {
        return json({
          erro: "Falha ao gerar Pix.",
          detalhe: erro.message
        }, 500);
      }
    }

    // CONSULTAR STATUS
    if (request.method === "GET" && url.pathname === "/status") {
      const orderId = url.searchParams.get("order_id");

      if (!orderId) {
        return json({ erro: "Order ID não informado." }, 400);
      }

      try {
        const resposta = await fetch(
          "https://api.mercadopago.com/v1/orders/" +
          encodeURIComponent(orderId),
          {
            headers: {
              "Authorization": `Bearer ${env.MP_ACCESS_TOKEN}`
            }
          }
        );

        const dados = await resposta.json();

        if (!resposta.ok) {
          return json({
            erro: "Erro ao consultar pedido.",
            detalhe: dados
          }, resposta.status);
        }

        const pagamento = dados.transactions?.payments?.[0];

        return json({
          order_id: dados.id,
          status: dados.status,
          status_pagamento: pagamento?.status || null,
          detalhe: pagamento?.status_detail || dados.status_detail || null
        });

      } catch (erro) {
        return json({
          erro: "Falha na consulta.",
          detalhe: erro.message
        }, 500);
      }
    }

    return json({
      projeto: "3 Fotos Studio",
      servidor: "ativo"
    });
  }
};
