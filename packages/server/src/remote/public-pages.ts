/* Public pages (pt-BR): landing, how to connect, privacy policy, terms of use and support.
 * Facts stated here (retention, limits, link lifetimes) mirror the server configuration. */

import { h, page, type PageContext } from "./pages.js";

export interface PublicInfo {
  supportEmail: string;
  mcpUrl: string;
  /** Data controller (person or company); null shows a generic description. */
  operatorName: string | null;
  limits: { presentations: number; slides: number; storageBytes: number; imageBytes: number };
  linkTtlHours: number;
  /** The Claude Desktop extension, when the server has one to offer. */
  desktopExtension?: { url: string; bytes: number } | null;
}

const UPDATED = "30 de outubro de 2026";
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
const mail = (email: string) => `<a href="mailto:${h(email)}">${h(email)}</a>`;

function controller(ctx: PageContext, p: PublicInfo): string {
  return p.operatorName
    ? `${h(p.operatorName)}, pessoa física, responsável pelo ${h(ctx.productName)}`
    : `o responsável pelo ${h(ctx.productName)} (pessoa física)`;
}

export function landingPage(ctx: PageContext, p: PublicInfo): string {
  return page(
    ctx,
    "Apresentações criadas pela sua IA",
    `<section class="hero">
<h1>Apresentações criadas pela sua IA, prontas para apresentar</h1>
<p>Peça ao Claude, ao ChatGPT ou ao Gemini e receba slides bonitos, que você edita no navegador e apresenta em qualquer lugar — até offline.</p>
<div class="row"><a class="btn primary" href="/cadastro">Criar conta grátis</a><a class="btn" href="/entrar">Entrar</a><a class="btn" href="/como-conectar">Como conectar</a></div>
</section>
<div class="grid">
<div class="card"><h3>Feito pela IA</h3><p class="muted">A IA escolhe layouts, organiza o conteúdo, monta gráficos e escreve as notas do apresentador.</p></div>
<div class="card"><h3>Editável por você</h3><p class="muted">Ajuste textos, imagens e temas no editor visual. A IA enxerga suas alterações e continua de onde você parou.</p></div>
<div class="card"><h3>Apresente em qualquer lugar</h3><p class="muted">Um único arquivo HTML que funciona offline, com transições, modo apresentador e passador de slides.</p></div>
</div>
<div class="card" style="margin-top:22px"><h1 style="font-size:20px">Como funciona</h1>
<ol class="steps">
<li>Crie sua conta no ${h(ctx.productName)}.</li>
<li>Conecte sua IA com o endereço <code>${h(p.mcpUrl)}</code> (<a href="/como-conectar">passo a passo</a>).</li>
<li>Peça: <em>“crie uma apresentação de 8 slides sobre…”</em> e abra o link do editor.</li>
</ol></div>`,
    { width: 880 },
  );
}

function desktopSection(ctx: PageContext, p: PublicInfo): string {
  const ext = p.desktopExtension;
  if (!ext) return "";
  const name = h(ctx.productName);
  return `<h2>Claude Desktop, sem conta (no seu computador)</h2>
<p>Prefere que as apresentações fiquem só no seu computador? Instale a extensão do ${name} no Claude Desktop (macOS ou Windows). Ela não usa conta nem este servidor: as apresentações, as imagens e os HTML exportados ficam numa pasta sua, e o editor abre no seu navegador.</p>
<p><a class="btn primary" href="${h(ext.url)}" download>Baixar a extensão (${(ext.bytes / 1048576).toFixed(0)} MB)</a></p>
<ol><li>Dê dois cliques no arquivo <code>slideia.mcpb</code> baixado, ou arraste-o para a janela do Claude Desktop. Também dá para instalar em <strong>Configurações → Extensões → Configurações avançadas → Instalar extensão</strong>.</li>
<li>Escolha a pasta das apresentações (padrão: <code>Apresentacoes</code>, na sua pasta pessoal) e conclua a instalação.</li>
<li>Numa conversa, peça a apresentação. A prévia dos slides usa o Google Chrome ou o Microsoft Edge instalado.</li></ol>
<p class="muted">Use a extensão <strong>ou</strong> o conector acima, não os dois ao mesmo tempo: cada um guarda as apresentações num lugar diferente.</p>
`;
}

export function connectPage(ctx: PageContext, p: PublicInfo): string {
  const url = `<div class="url">${h(p.mcpUrl)}</div>`;
  return page(
    ctx,
    "Como conectar",
    `<div class="card doc"><h1>Como conectar sua IA</h1>
<p>O ${h(ctx.productName)} funciona como um conector (servidor MCP). Em todas as IAs o endereço é o mesmo:</p>${url}
<p class="muted">Na primeira conexão, a IA abre a tela de login do ${h(ctx.productName)}. Entre com sua conta (ou crie uma) e clique em <strong>Permitir</strong>. Os nomes dos menus de cada IA mudam com frequência; se não encontrar algum, procure por “conectores” ou “apps” nas configurações.</p>

<h2>Claude (claude.ai e app)</h2>
<ol><li>Abra <strong>Configurações → Conectores</strong> e clique em <strong>Adicionar conector personalizado</strong>.</li>
<li>Nome: <strong>${h(ctx.productName)}</strong>. URL: o endereço acima. Clique em <strong>Adicionar</strong> e depois em <strong>Conectar</strong>.</li>
<li>Numa conversa, peça a apresentação. Se a IA não usar o conector, ative-o no menu de ferramentas da conversa.</li></ol>

<h2>ChatGPT</h2>
<ol><li>Em <strong>Configurações → Apps e conectores</strong>, ative o <strong>modo desenvolvedor</strong> (em configurações avançadas) e clique em <strong>Criar</strong>.</li>
<li>Nome: <strong>${h(ctx.productName)}</strong>; URL: o endereço acima; autenticação: <strong>OAuth</strong>.</li>
<li>Numa conversa nova, selecione o ${h(ctx.productName)} nas ferramentas e faça o pedido.</li></ol>

<h2>Gemini</h2>
<p class="muted"><strong>Atenção:</strong> por uma limitação do próprio Gemini, os apps personalizados só funcionam com a interface e o pedido em inglês. O conteúdo dos slides pode ser em português.</p>
<ol><li>Abra <a href="https://gemini.google.com/app?hl=en" rel="noopener">gemini.google.com/app?hl=en</a> (interface em inglês).</li>
<li>Em <strong>Settings → Connected apps → Custom apps</strong>, adicione o endereço acima e conclua o login.</li>
<li>Numa conversa nova, digite <code>@</code>, <strong>selecione o ${h(ctx.productName)}</strong> na lista e escreva em inglês, por exemplo: <em>“create a 6-slide presentation about solar energy in Brazilian Portuguese and send me the editor link”</em>.</li>
<li>O Gemini pede confirmação (<strong>Allow</strong>) antes de criar ou alterar uma apresentação.</li></ol>

${desktopSection(ctx, p)}
<h2>Claude Code, Gemini CLI e outros clientes MCP</h2>
<p>Use o transporte <strong>Streamable HTTP</strong> com OAuth. No Claude Code:</p>
<div class="url">claude mcp add --transport http slideia ${h(p.mcpUrl)}</div>
<p>No Gemini CLI:</p>
<div class="url">gemini mcp add --transport http slideia ${h(p.mcpUrl)}</div>

<h2>Depois de conectar</h2>
<ul><li>A IA devolve dois links: o do <strong>editor</strong> (exige login) e o de <strong>download</strong> do HTML, que vale por ${p.linkTtlHours} horas.</li>
<li>Para apresentar, abra o HTML e pressione <strong>F5</strong>; <strong>S</strong> abre a visão do apresentador e <strong>T</strong> testa o passador.</li>
<li>No Claude e no ChatGPT os slides aparecem num carrossel dentro da conversa, com botões para abrir no editor, apresentar e baixar.</li>
<li>Para mostrar a apresentação a quem não tem conta, use <strong>Compartilhar</strong> no editor (ou peça à IA): o link funciona até você desativá-lo.</li>
<li>Você pode desconectar uma IA a qualquer momento em <a href="/conta">Minha conta</a>.</li></ul>
<p class="muted">Algo não funcionou? Veja o <a href="/suporte">suporte</a>.</p></div>`,
    { wide: true },
  );
}

export function privacyPage(ctx: PageContext, p: PublicInfo): string {
  const name = h(ctx.productName);
  return page(
    ctx,
    "Política de privacidade",
    `<div class="card doc"><h1>Política de privacidade</h1>
<p class="muted">Última atualização: ${UPDATED}</p>
<p>Esta política explica quais dados pessoais o ${name} trata, para quê e quais são os seus direitos, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).</p>

<h2>1. Quem é o controlador</h2>
<p>O controlador dos dados é ${controller(ctx, p)}. O encarregado pelo tratamento de dados pessoais pode ser contatado pelo e-mail ${mail(p.supportEmail)}.</p>

<h2>2. Quais dados tratamos</h2>
<ul>
<li><strong>Conta:</strong> nome (opcional), e-mail e senha. A senha nunca é guardada em texto: armazenamos apenas um resumo criptográfico (hash scrypt).</li>
<li><strong>Conteúdo:</strong> as apresentações que você ou sua IA criam, o histórico de versões e as imagens enviadas por você ou baixadas de endereços indicados nas apresentações.</li>
<li><strong>Aplicativos conectados:</strong> quais IAs você autorizou (por exemplo, Claude, ChatGPT ou Gemini), as permissões concedidas e a data. Os tokens de acesso são guardados apenas como hash.</li>
<li><strong>Dados técnicos:</strong> endereço IP, navegador e páginas acessadas, registrados pelo servidor web; e registros da aplicação sem o conteúdo das apresentações, com seu usuário identificado por um código pseudonimizado.</li>
<li><strong>Cookies:</strong> apenas os essenciais — o de sessão (válido por até 30 dias) e um de proteção contra falsificação de requisições. Não usamos cookies de publicidade nem ferramentas de análise de terceiros. A preferência de tema claro/escuro fica só no seu navegador.</li>
</ul>

<h2>3. Para que usamos e com qual base legal</h2>
<table>
<tr><th>Finalidade</th><th>Base legal (LGPD)</th></tr>
<tr><td>Criar e manter sua conta, guardar, editar, exibir e exportar suas apresentações</td><td>Execução de contrato (art. 7º, V)</td></tr>
<tr><td>Permitir que uma IA conectada por você leia e edite suas apresentações</td><td>Execução de contrato e sua autorização na tela de consentimento</td></tr>
<tr><td>Enviar e-mails da conta (confirmação de e-mail, recuperação de senha)</td><td>Execução de contrato (art. 7º, V)</td></tr>
<tr><td>Segurança, prevenção de abuso e correção de falhas (registros técnicos)</td><td>Legítimo interesse (art. 7º, IX)</td></tr>
</table>
<p>Não vendemos seus dados, não os usamos para publicidade e <strong>não usamos o conteúdo das suas apresentações para treinar modelos de IA</strong>.</p>

<h2>4. Assistentes de IA conectados</h2>
<p>Quando você conecta o ${name} a uma IA (Claude, ChatGPT, Gemini ou outra), é essa IA que conversa com você e envia ao ${name} o conteúdo das apresentações. O tratamento das suas conversas pela IA segue a política de privacidade da empresa responsável por ela (Anthropic, OpenAI, Google etc.). O ${name} só recebe o que a IA envia por meio das ferramentas que você autorizou e pode ser desconectado a qualquer momento em <a href="/conta">Minha conta</a>.</p>

<h2>5. Com quem compartilhamos</h2>
<ul>
<li><strong>Hostinger:</strong> hospeda o servidor, o banco de dados, as imagens e o serviço de e-mail. Atua como operador, tratando os dados apenas para prestar esses serviços.</li>
<li><strong>Quem tiver um link de download ou de apresentação:</strong> esses links dão acesso à apresentação correspondente, sem login, por ${p.linkTtlHours} horas. Compartilhe-os com cuidado.</li>
<li><strong>Quem tiver um link de compartilhamento:</strong> se você ativar o compartilhamento de uma apresentação, qualquer pessoa com o link pode assisti-la (sem editar), sempre na versão mais recente, até você desativar o link. Esses links não são indexados por buscadores.</li>
<li><strong>Autoridades:</strong> quando houver obrigação legal ou ordem judicial.</li>
</ul>

<h2>6. Transferência internacional</h2>
<p>O servidor do ${name} está localizado nos Estados Unidos. Por isso, seus dados são transferidos para fora do Brasil, o que é necessário para a prestação do serviço que você contratou (art. 33, IX, da LGPD). Adotamos as medidas de segurança descritas no item 8.</p>

<h2>7. Por quanto tempo guardamos</h2>
<ul>
<li><strong>Conta e conteúdo:</strong> enquanto sua conta existir. Ao excluir a conta, apresentações, imagens, sessões e conexões são apagadas na hora.</li>
<li><strong>Cópias de segurança:</strong> mantidas por até 14 dias; dados excluídos desaparecem delas nesse prazo.</li>
<li><strong>Registros técnicos:</strong> até 14 dias no servidor web; os registros da aplicação são rotacionados automaticamente.</li>
</ul>

<h2>8. Segurança</h2>
<p>Usamos conexão criptografada (HTTPS) em todo o site, senhas e tokens guardados apenas como hash, isolamento dos dados por conta, links assinados com prazo de validade, proteção contra acesso a endereços internos no download de imagens e cópias de segurança diárias. Nenhum sistema é totalmente imune a incidentes; se ocorrer um incidente relevante, comunicaremos os afetados e a ANPD conforme a lei.</p>

<h2>9. Seus direitos</h2>
<p>Você pode, a qualquer momento (art. 18 da LGPD):</p>
<ul>
<li><strong>Acessar e levar seus dados:</strong> use <em>Exportar meus dados</em> em <a href="/conta">Minha conta</a> para baixar tudo em JSON, incluindo as imagens.</li>
<li><strong>Excluir seus dados:</strong> use <em>Excluir minha conta</em> em <a href="/conta">Minha conta</a>.</li>
<li><strong>Revogar autorizações:</strong> desconecte qualquer IA em <a href="/conta">Minha conta</a>.</li>
<li><strong>Corrigir dados, pedir informações</strong> sobre o tratamento ou exercer outros direitos: escreva para ${mail(p.supportEmail)}.</li>
<li><strong>Reclamar à Autoridade Nacional de Proteção de Dados (ANPD)</strong>, em <a href="https://www.gov.br/anpd" rel="noopener">gov.br/anpd</a>.</li>
</ul>

<h2>10. Idade mínima</h2>
<p>O ${name} é destinado a maiores de 18 anos.</p>

<h2>11. Alterações</h2>
<p>Se esta política mudar de forma relevante, avisaremos pelo site e, quando possível, por e-mail. A data da última atualização fica no topo da página.</p>
<p>Dúvidas: ${mail(p.supportEmail)}.</p></div>`,
    { wide: true },
  );
}

export function termsPage(ctx: PageContext, p: PublicInfo): string {
  const name = h(ctx.productName);
  return page(
    ctx,
    "Termos de uso",
    `<div class="card doc"><h1>Termos de uso</h1>
<p class="muted">Última atualização: ${UPDATED}</p>
<p>Estes termos regem o uso do ${name}, oferecido por ${controller(ctx, p)}. Ao criar uma conta ou usar o serviço, você concorda com eles e com a <a href="/privacidade">Política de privacidade</a>.</p>

<h2>1. O serviço</h2>
<p>O ${name} permite criar, editar e apresentar slides em HTML, diretamente ou por meio de assistentes de IA conectados. O serviço é <strong>gratuito</strong> neste momento. Se planos pagos forem criados no futuro, eles serão opcionais e anunciados com antecedência.</p>
<p>Limites atuais por conta: até ${p.limits.presentations} apresentações, ${p.limits.slides} slides por apresentação, imagens de até ${mb(p.limits.imageBytes)} e ${mb(p.limits.storageBytes)} de armazenamento. Os limites podem ser ajustados para manter o serviço estável.</p>

<h2>2. Sua conta</h2>
<ul><li>Você precisa ter 18 anos ou mais e informar um e-mail válido.</li>
<li>Você é responsável por manter sua senha em segredo e pelas ações feitas com sua conta, inclusive por IAs que você autorizou.</li></ul>

<h2>3. Seu conteúdo</h2>
<ul><li>As apresentações e imagens são suas. Você mantém todos os direitos sobre elas.</li>
<li>Você nos concede apenas a permissão necessária para armazenar, processar e exibir esse conteúdo para prestar o serviço a você (por exemplo, gerar o HTML, as pré-visualizações e os links que você pedir).</li>
<li>Você declara ter os direitos necessários sobre textos e imagens que enviar ou mandar a IA incluir.</li></ul>

<h2>4. Conteúdo gerado por IA</h2>
<p>Textos, números e imagens sugeridos por assistentes de IA podem conter erros ou informações desatualizadas. Revise o conteúdo antes de apresentá-lo ou divulgá-lo. O ${name} não garante a exatidão do que é gerado pelas IAs, que são serviços de terceiros com termos próprios.</p>

<h2>5. Uso aceitável</h2>
<p>Não é permitido usar o ${name} para:</p>
<ul><li>conteúdo ilegal, discriminatório, que incite violência ou viole direitos de terceiros (inclusive direitos autorais e de imagem);</li>
<li>distribuir malware, phishing ou spam;</li>
<li>tentar acessar dados de outras contas, burlar limites ou a segurança do serviço;</li>
<li>sobrecarregar o serviço com uso automatizado abusivo.</li></ul>
<p>Podemos remover conteúdo ou suspender contas que violem estes termos, avisando sempre que possível.</p>

<h2>6. Integrações de terceiros</h2>
<p>A conexão com Claude, ChatGPT, Gemini e outros clientes depende desses serviços, que podem mudar seu funcionamento ou disponibilidade sem aviso. O uso deles segue os termos das respectivas empresas.</p>

<h2>7. Disponibilidade</h2>
<p>O serviço é oferecido “no estado em que se encontra”, sem garantia de funcionamento ininterrupto. Fazemos cópias de segurança diárias, mas recomendamos que você guarde os arquivos HTML ou exporte seus dados periodicamente.</p>

<h2>8. Responsabilidade</h2>
<p>Na máxima extensão permitida pela lei, não nos responsabilizamos por danos indiretos, lucros cessantes ou perda de dados decorrentes do uso ou da impossibilidade de uso do serviço. Nada nestes termos limita direitos que a lei garante ao consumidor.</p>

<h2>9. Encerramento</h2>
<ul><li>Você pode excluir sua conta a qualquer momento em <a href="/conta">Minha conta</a>.</li>
<li>Se o ${name} for descontinuado, avisaremos com pelo menos 30 dias de antecedência para que você exporte seus dados.</li></ul>

<h2>10. Alterações</h2>
<p>Podemos atualizar estes termos. Mudanças relevantes serão avisadas pelo site e, quando possível, por e-mail. Continuar usando o serviço após a mudança significa concordar com a nova versão.</p>

<h2>11. Lei e foro</h2>
<p>Estes termos são regidos pelas leis brasileiras. Fica eleito o foro da Comarca de Niterói/RJ, ressalvado o direito do consumidor de propor ação no foro do seu domicílio.</p>
<p>Contato: ${mail(p.supportEmail)}.</p></div>`,
    { wide: true },
  );
}

export function supportPage(ctx: PageContext, p: PublicInfo): string {
  const name = h(ctx.productName);
  return page(
    ctx,
    "Suporte",
    `<div class="card doc"><h1>Suporte</h1>
<p>Escreva para ${mail(p.supportEmail)}. Respondemos em até 2 dias úteis. Se possível, conte qual IA você usa (Claude, ChatGPT, Gemini…) e o que aconteceu.</p>

<h2>Perguntas frequentes</h2>
<h3>Como conecto minha IA?</h3>
<p>Siga o <a href="/como-conectar">passo a passo</a>. O endereço do conector é <code>${h(p.mcpUrl)}</code>.</p>

<h3>A IA respondeu com texto em vez de criar a apresentação</h3>
<ul><li>Confira se o ${name} está conectado e ativado na conversa.</li>
<li>Comece uma conversa nova depois de conectar.</li>
<li>No <strong>Gemini</strong>, use a interface e o pedido em inglês e selecione o ${name} digitando <code>@</code>.</li>
<li>Seja explícito: <em>“use o ${name} para criar…”</em>.</li></ul>

<h3>Não aparece o carrossel com os slides na conversa</h3>
<p>O Claude e o ChatGPT mostram os slides dentro da conversa. Eles guardam a lista de recursos do ${name} de quando você conectou; depois de uma atualização do ${name}, <strong>desconecte e conecte de novo</strong> nas configurações da IA (ou use “Atualizar”, se houver) e abra uma conversa nova. Quem não reconecta continua usando tudo normalmente, só sem a novidade. O Gemini ainda não mostra o carrossel.</p>

<h3>O link de download não abre mais</h3>
<p>Os links de download e de apresentação valem por ${p.linkTtlHours} horas. Peça um novo link à IA ou abra a apresentação no <a href="/">editor</a> e use <strong>Baixar</strong>.</p>

<h3>Como apresento?</h3>
<p>Abra o arquivo HTML no navegador e pressione <strong>F5</strong>. <strong>S</strong> abre a visão do apresentador; <strong>T</strong> testa as teclas do passador. O arquivo funciona offline.</p>

<h3>Esqueci minha senha</h3>
<p>Use <a href="/esqueci-senha">Esqueci minha senha</a> na tela de entrada.</p>

<h3>Como desconecto uma IA ou excluo meus dados?</h3>
<p>Em <a href="/conta">Minha conta</a> você desconecta aplicativos, exporta todos os seus dados e pode excluir a conta. Veja também a <a href="/privacidade">Política de privacidade</a>.</p></div>`,
    { wide: true },
  );
}
