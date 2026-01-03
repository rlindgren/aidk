import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";
import { provideRouter } from "@angular/router";
import { provideEngine } from "aidk-angular";
// import { SSETransport } from '@packages/client/core'; // Example: custom transport

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter([]),
    provideEngine({
      baseUrl: "", // Proxied via proxy.conf.json
      routes: {
        // Match the express server's agent routes
        stream: (id) => `/api/agents/${id}/stream`,
        execute: (id) => `/api/agents/${id}/execute`,
      },
    }),
  ],
}).catch((err) => console.error(err));
