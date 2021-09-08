import fs from "fs";
import path from "path";
import { GraphQLClient, gql } from "graphql-request";
import prompts from "prompts";

type Config = {
  shopName: string,
  accessToken: string,
};

const configPath = path.join(__dirname, "config.json");

async function loadConfig(): Promise<Config> {
  if (fs.existsSync(configPath)) {
    console.log(`Using config from ${configPath}...`);
    return JSON.parse(await fs.promises.readFile(configPath, "utf-8"));
  }

  const config = await askConfig();

  console.log(`Writing config to ${configPath}.`);
  fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));

  return config;
}

type Publication = {
  gid: string,
  name: string,
};

class Client {
  private gqlClient: GraphQLClient;

  constructor(config: Config) {
    const url = `https://${config.shopName}.myshopify.com/admin/api/2021-07/graphql.json`;

    this.gqlClient = new GraphQLClient(url, {
      headers: { "X-Shopify-Access-Token": config.accessToken },
    });
  }

  async listPublications(): Promise<Publication[]> {
    const r = await this.gqlClient.request(
      gql`{ publications(first: 20) { edges { node { gid: id, name } } } }`
    );

    return r.publications.edges.map((e: any) => e.node);
  }

  async listProductPublications(productId: string): Promise<Publication[]> {
    const productGid = `gid://shopify/Product/${productId}`;

    const r = await this.gqlClient.request(
      gql`query ($productGid: ID!) {
        product(id: $productGid) {
          resourcePublicationsV2(first: 10) {
            edges {
              node {
                publication {
                  gid: id
                  name
                }
              }
            }
          }
        }
      }`,
      { productGid },
    );

    return r.product.resourcePublicationsV2.edges.map((e: any) => e.node.publication);
  }

  async publishProduct(productId: string, publicationGid: string): Promise<void> {
    const productGid = `gid://shopify/Product/${productId}`;
    const publishDate = new Date().toISOString();

    const r = await this.gqlClient.request(
      gql`mutation ($productGid: ID!, $publicationGid: ID!, $publishDate: DateTime){
        publishablePublish(id: $productGid,
          input:{ publicationId: $publicationGid, publishDate: $publishDate}) {
          userErrors {
            message
          }
        }
      }`,
      { productGid, publicationGid, publishDate },
    );

    const userErrors = r.publishablePublish.userErrors as { message: string }[];
    if (userErrors.length > 0) {
      console.warn("Got errors while publishing", userErrors);
      throw new Error("Unable to publish");
    }
  }
}

// Prompts

async function askConfig(): Promise<Config> {
  return await prompts([{
    type: "text",
    name: "shopName",
    message: "Enter shop name (<shopname>.myshopify.com):",
  }, {
    type: "password",
    name: "accessToken",
    message: "Enter access token / private api key:",
  }]);
};

async function askProductId(): Promise<string | undefined> {
  return (await prompts({
    type: "text",
    name: "productId",
    message: "Enter product id",
    // initial: "",
  })).productId;
}

async function askPublicationGid(pubs: Publication[]): Promise<string | undefined> {
  const skipChoice = { title: "Skip", value: "" };
  const pubChoices = pubs.map(pub => ({ title: pub.name, value: pub.gid }));

  const publicationGid = (await prompts({
    type: "select",
    name: "publicationGid",
    message: "Choose where to publish",
    choices: [skipChoice, ...pubChoices],
  })).publicationGid;

  if (publicationGid === "") {
    return;
  }

  return publicationGid;
}

// Printer

function printPublications(label: string, ps: Publication[]): void {
  console.log();
  console.log(`${label} (${ps.length})\n`);
  for (const p of ps) {
    console.log(`* ${p.name} (${p.gid})`);
  }
  console.log();
}

// Main

async function main(): Promise<void> {
  const config = await loadConfig();

  const client = new Client(config);
  const allPublications = await client.listPublications();

  console.log("Looking for all publications...");
  printPublications("All publications", allPublications);

  while (true) {
    const productId = await askProductId();

    if (productId === void 0 || productId === "") {
      console.log("Done!");
      break;
    }

    console.log(`Looking for publications for product ${productId}...`);
    const productPublications = await client.listProductPublications(productId);

    printPublications(`Publications for product ${productId}`, productPublications);

    const publicationGid = await askPublicationGid(allPublications);
    if (publicationGid === void 0) {
      console.log("Skipping.");
      continue;
    }

    console.log(`Publish product ${productId} to ${publicationGid}...`);
    await client.publishProduct(productId, publicationGid);
  }
};

// run main
main();
