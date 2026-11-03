
export default {
  async fetch(request, env) {
    const DEFAULT_ORIGIN =
      "https://3-fotos-studio.celufixcomercioeservicos.workers.dev";

    const allowedOrigins = (
      env.ALLOWED_ORIGINS || DEFAULT_ORIGIN
    ).split(",").map(v => v.trim()).filter(Boolean);

    const origin = request.headers.get("Origin");
    const allowedOrigin = origin
      ? allowedOrigins.includes(origin)
        ? origin
        : null
      : allowedOrigins[0];

    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": allowedOrigin || "null",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers
      });

    if (origin && !allowedOrigin) {
      return json({ erro: "Site não autorizado." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    if (!env.MP_ACCESS_TOKEN) {
      return json({
        erro: "Access Token do Mercado Pago não configurado."
      }, 500);
    }

    const url = new URL(request.url);

    // PACOTES
    const pacotes = {
      video1: 29.90,
      video3: 79.90,
      video5: 129.90,
      video10: 229.90
    };

    // CRIAR PIX
    if (
      request.method === "POST" &&
      url.pathname === "/criar-pix"
    ) {
      try {
        let body;

        try {
          body = await request.json();
        } catch {
          return json({ erro: "JSON inválido." }, 400);
        }

        const pacote = String(body.pacote || "").trim();
        const valor = pacotes[pacote];
        const email = String(body.email || "").trim();

        if (!valor) {
          return json({
            erro: "Pacote inválido.",
            pacotes_disponiveis: Object.keys(pacotes)
          }, 400);
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
                email
              }
            })
          }
        );

        const dados = await resposta.json();

        if (!resposta.ok) {
          console.error("Erro Mercado Pago:", dados);

          return json({
            erro: "Mercado Pago recusou a criação do Pix.",
            detalhe: dados
          }, resposta.status);
        }

        const pagamento =
          dados.transactions?.payments?.[0] || {};

        const metodo = pagamento.payment_method || {};

        // LOCALIZAÇÃO DOS DADOS DO PIX
        const pix =
          metodo.qr_code ||
          pagamento.qr_code ||
          dados.point_of_interaction?.transaction_data?.qr_code ||
          null;

        const qrBase64 =
          metodo.qr_code_base64 ||
          pagamento.qr_code_base64 ||
          dados.point_of_interaction?.transaction_data?.qr_code_base64 ||
          null;

        const ticket =
          metodo.ticket_url ||
          pagamento.ticket_url ||
          null;

        if (!pix && !qrBase64 && !ticket) {
          console.error("Resposta sem dados Pix:", dados);

          return json({
            erro: "Pedido criado, mas o Mercado Pago não retornou os dados do Pix.",
            order_id: dados.id || null,
            status: dados.status || null,
            status_pagamento: pagamento.status || null,
            detalhe: pagamento.status_detail || null
          }, 502);
        }

        return json({
          sucesso: true,
          pedido: dados.id,
          order_id: dados.id,
          valor: valor,
          pacote: pacote,
          status: dados.status,
          status_pagamento: pagamento.status || null,
          status_detalhe: pagamento.status_detail || null,
          pix_copia_cola: pix,
          qr_code: pix,
          qr_code_base64: qrBase64,
          link_pagamento: ticket,
          ticket_url: ticket
        }, 201);

      } catch (erro) {
        console.error("Falha ao criar Pix:", erro);

        return json({
          erro: "Falha ao gerar Pix.",
          detalhe: erro.message
        }, 500);
      }
    }

    // CONSULTAR STATUS DO PAGAMENTO
    if (
      request.method === "GET" &&
      url.pathname === "/status"
    ) {
      const orderId = url.searchParams.get("order_id");

      if (!orderId) {
        return json({
          erro: "Order ID não informado."
        }, 400);
      }

      try {
        const resposta = await fetch(
          "https://api.mercadopago.com/v1/orders/" +
          encodeURIComponent(orderId),
          {
            method: "GET",
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

        const pagamento =
          dados.transactions?.payments?.[0] || {};

        return json({
          sucesso: true,
          order_id: dados.id,
          status: dados.status || null,
          status_pagamento: pagamento.status || null,
          detalhe: pagamento.status_detail ||
            dados.status_detail || null,
          valor: pagamento.amount || dados.total_amount || null,
          pago: pagamento.status === "processed"
        });

      } catch (erro) {
        console.error("Erro ao consultar status:", erro);

        return json({
          erro: "Falha na consulta.",
          detalhe: erro.message
        }, 500);
      }
    }

    // TESTE DO SERVIDOR
    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return json({
        projeto: "3 Fotos Studio",
        servidor: "ativo",
        pagamento: "Mercado Pago",
        pix: "integrado",
        rotas: [
          "/criar-pix",
          "/status?order_id=ID"
        ]
      });
    }

    return json({
      erro: "Rota não encontrada."
    }, 404);
  }
};
