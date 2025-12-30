# aidk-openai

Direct OpenAI adapter for AIDK.

## Installation

```bash
pnpm add aidk-openai
```

## Usage

```tsx
import { OpenAIModel } from 'aidk-openai';

<OpenAIModel
  apiKey={process.env.OPENAI_API_KEY}
  model="gpt-4o"
  temperature={0.7}
  maxTokens={4096}
/>

// With custom base URL (Azure, etc.)
<OpenAIModel
  apiKey={process.env.AZURE_OPENAI_KEY}
  baseURL="https://your-resource.openai.azure.com"
  model="gpt-4"
/>
```

## Configuration

| Prop          | Type      | Description                 |
| ------------- | --------- | --------------------------- |
| `apiKey`      | `string`  | OpenAI API key              |
| `model`       | `string`  | Model name (e.g., `gpt-4o`) |
| `baseURL`     | `string?` | Custom API endpoint         |
| `temperature` | `number?` | Sampling temperature        |
| `maxTokens`   | `number?` | Maximum tokens              |

## Documentation

See the [full documentation](https://rlindgren.github.io/aidk).
