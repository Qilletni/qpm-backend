# QPM Backend

This is the backend for the Qilletni Package Manager. This is a relatively simple project hosted on Cloudflare workers. Client-side communication is done via the [QPM CLI](https://github.com/Qilletni/QPMCLI). Authentication is through GitHub, and each package is scoped with a username or organization name. The following are the Cloudflare components used:
- **R2 Bucket**: Storage for package archives/metadata
- **Durable Objects**: Rate limiting
- **KV Namespace**: Permissions and caching GitHub response data

For more information on packages, see the [Package Management](https://qilletni.dev/packages/package_management/) docs.
