import OpenAI, { APIConnectionError, APIError } from 'openai';

const apiKey = process.env.OPENAI_API_KEY?.trim();
const placeholderValues = new Set(['', 'your_key_goes_here', 'your_openai_api_key_here']);
const model = 'gpt-5.4-nano';
const prompt = 'You are the AI reasoning layer for SupplyChain AI. Respond with exactly: SupplyChain AI connection successful.';

if (!apiKey || placeholderValues.has(apiKey.toLowerCase())) {
  console.error('OpenAI connectivity test not run: OPENAI_API_KEY is missing or still a placeholder in .env.');
  process.exitCode = 1;
} else {
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model,
      input: prompt,
      max_output_tokens: 32,
      store: false,
    });
    console.log(response.output_text);
    if (response.output_text !== 'SupplyChain AI connection successful.') {
      console.error('OpenAI responded, but the text did not exactly match the requested response.');
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    process.exitCode = 1;
    if (error instanceof APIConnectionError) {
      console.error('OpenAI API request failed: APIConnectionError. Likely cause: network, DNS, TLS, or proxy connectivity.');
    } else if (error instanceof APIError) {
      const status = error.status;
      const category = status === 401 ? 'AuthenticationError'
        : status === 403 ? 'PermissionDeniedError'
          : status === 429 ? 'RateLimitError'
            : status === 404 ? 'NotFoundError'
              : status !== undefined && status >= 500 ? 'ServerError'
                : 'APIError';
      const likelyCause = status === 401 ? 'the API key is invalid, revoked, or not being accepted'
        : status === 403 ? 'the project or key lacks access to the requested model/API'
          : status === 429 ? 'rate limits, project spend limits, or billing/credits'
            : status === 404 ? 'the model or endpoint is unavailable to this project'
              : status !== undefined && status >= 500 ? 'a temporary OpenAI service issue'
                : 'an API request or account configuration issue';
      console.error(`OpenAI API request failed: ${category} (HTTP ${status ?? 'unknown'}). Likely cause: ${likelyCause}.`);
    } else {
      console.error('OpenAI connectivity test failed: unexpected client/runtime error; details omitted to protect credentials.');
    }
  }
}
