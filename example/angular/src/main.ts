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
      // transport: new SSETransport({ ... }), // Optional: provide custom transport
      // channels: myChannelClient, // Optional: provide pre-configured ChannelClient
    }),
  ],
}).catch((err) => console.error(err));
