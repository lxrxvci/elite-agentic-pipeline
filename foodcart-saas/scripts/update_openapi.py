"""Add billing, domain, and webhook paths/schemas to openapi.yaml."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
OPENAPI_PATH = ROOT / "openapi.yaml"

NEW_PATHS = {
    "/billing/plans": {
        "get": {
            "tags": ["Billing"],
            "summary": "List subscription plans",
            "responses": {
                "200": {
                    "description": "Available plans",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/BillingPlansResponse"}
                        }
                    },
                }
            },
        }
    },
    "/billing/current": {
        "get": {
            "tags": ["Billing"],
            "summary": "Get current subscription",
            "responses": {
                "200": {
                    "description": "Current subscription state",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/SubscriptionResponse"}
                        }
                    },
                }
            },
        }
    },
    "/billing/checkout": {
        "post": {
            "tags": ["Billing"],
            "summary": "Create Paddle checkout",
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/CheckoutRequest"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Checkout URL",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/CheckoutResponse"}
                        }
                    },
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
            },
        }
    },
    "/billing/portal": {
        "post": {
            "tags": ["Billing"],
            "summary": "Create customer portal session",
            "responses": {
                "200": {
                    "description": "Portal URL",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/PortalResponse"}
                        }
                    },
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
            },
        }
    },
    "/billing/cancel": {
        "post": {
            "tags": ["Billing"],
            "summary": "Cancel subscription at period end",
            "responses": {
                "200": {
                    "description": "Updated subscription state",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/SubscriptionResponse"}
                        }
                    },
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
            },
        }
    },
    "/billing/resume": {
        "post": {
            "tags": ["Billing"],
            "summary": "Resume a scheduled cancellation",
            "responses": {
                "200": {
                    "description": "Updated subscription state",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/SubscriptionResponse"}
                        }
                    },
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
            },
        }
    },
    "/domains/search": {
        "get": {
            "tags": ["Domains"],
            "summary": "Search domain names",
            "parameters": [
                {
                    "name": "q",
                    "in": "query",
                    "required": True,
                    "schema": {"type": "string"},
                }
            ],
            "responses": {
                "200": {
                    "description": "Search results",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/DomainSearchResponse"}
                        }
                    },
                },
                "503": {"$ref": "#/components/responses/ServiceUnavailable"},
            },
        }
    },
    "/domains/check": {
        "post": {
            "tags": ["Domains"],
            "summary": "Check availability for up to 20 domains",
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "array",
                            "items": {"type": "string"},
                            "maxItems": 20,
                        }
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Availability results",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/DomainSearchResponse"}
                        }
                    },
                },
                "503": {"$ref": "#/components/responses/ServiceUnavailable"},
            },
        }
    },
    "/domains/sites/{site_id}/purchase": {
        "post": {
            "tags": ["Domains"],
            "summary": "Purchase a domain for a site",
            "parameters": [{"$ref": "#/components/parameters/SiteId"}],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/DomainPurchaseRequest"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Checkout URL for domain purchase",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/DomainPurchaseResponse"}
                        }
                    },
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
                "402": {"$ref": "#/components/responses/PaymentRequired"},
                "404": {"$ref": "#/components/responses/NotFound"},
                "422": {"$ref": "#/components/responses/Unprocessable"},
                "503": {"$ref": "#/components/responses/ServiceUnavailable"},
            },
        }
    },
    "/sites/{site_id}/domain": {
        "post": {
            "tags": ["Sites"],
            "summary": "Connect an external or purchased domain",
            "parameters": [{"$ref": "#/components/parameters/SiteId"}],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/ConnectDomainRequest"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Domain connection status",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/DomainStatusResponse"}
                        }
                    },
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
                "404": {"$ref": "#/components/responses/NotFound"},
            },
        },
        "delete": {
            "tags": ["Sites"],
            "summary": "Disconnect custom domain",
            "parameters": [{"$ref": "#/components/parameters/SiteId"}],
            "responses": {"204": {"description": "Domain disconnected"}},
        },
    },
    "/sites/{site_id}/domain/status": {
        "get": {
            "tags": ["Sites"],
            "summary": "Check custom domain verification status",
            "parameters": [{"$ref": "#/components/parameters/SiteId"}],
            "responses": {
                "200": {
                    "description": "Domain status",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/DomainStatusResponse"}
                        }
                    },
                },
                "404": {"$ref": "#/components/responses/NotFound"},
            },
        }
    },
    "/webhooks/paddle": {
        "post": {
            "tags": ["Webhooks"],
            "summary": "Receive Paddle webhook events",
            "security": [],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"type": "object"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Event received",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {"received": {"type": "boolean"}},
                            }
                        }
                    },
                },
                "400": {"$ref": "#/components/responses/BadRequest"},
                "401": {"$ref": "#/components/responses/Unauthorized"},
            },
        }
    },
}

NEW_SCHEMAS = {
    "BillingInterval": {
        "type": "string",
        "enum": ["month", "year"],
    },
    "PlanSchema": {
        "type": "object",
        "required": ["id", "name", "interval", "price_usd"],
        "properties": {
            "id": {"type": "string", "example": "base-monthly"},
            "name": {"type": "string", "example": "Base Subscription"},
            "interval": {"$ref": "#/components/schemas/BillingInterval"},
            "price_usd": {"type": "string", "example": "50.00"},
        },
    },
    "BillingPlansResponse": {
        "type": "object",
        "required": ["monthly", "yearly"],
        "properties": {
            "monthly": {"$ref": "#/components/schemas/PlanSchema"},
            "yearly": {"$ref": "#/components/schemas/PlanSchema"},
        },
    },
    "SubscriptionResponse": {
        "type": "object",
        "required": ["plan"],
        "properties": {
            "plan": {"type": "string", "example": "base"},
            "status": {"type": "string", "nullable": True, "example": "active"},
            "billing_interval": {
                "$ref": "#/components/schemas/BillingInterval",
                "nullable": True,
            },
            "current_period_start": {
                "type": "string",
                "format": "date-time",
                "nullable": True,
            },
            "current_period_end": {
                "type": "string",
                "format": "date-time",
                "nullable": True,
            },
            "trial_ends_at": {
                "type": "string",
                "format": "date-time",
                "nullable": True,
            },
            "canceled_at": {
                "type": "string",
                "format": "date-time",
                "nullable": True,
            },
            "paddle_subscription_id": {"type": "string", "nullable": True},
            "paddle_customer_id": {"type": "string", "nullable": True},
        },
    },
    "CheckoutRequest": {
        "type": "object",
        "required": ["interval"],
        "properties": {
            "interval": {"$ref": "#/components/schemas/BillingInterval"},
        },
    },
    "CheckoutResponse": {
        "type": "object",
        "required": ["checkout_url"],
        "properties": {
            "checkout_url": {"type": "string", "format": "uri"},
        },
    },
    "PortalResponse": {
        "type": "object",
        "required": ["url"],
        "properties": {
            "url": {"type": "string", "format": "uri"},
        },
    },
    "DomainAvailability": {
        "type": "object",
        "required": ["name", "registrable", "currency", "registration_cost", "renewal_cost"],
        "properties": {
            "name": {"type": "string", "example": "example.com"},
            "registrable": {"type": "boolean"},
            "currency": {"type": "string", "example": "USD"},
            "registration_cost": {"type": "string", "example": "12.99"},
            "renewal_cost": {"type": "string", "example": "12.99"},
            "reason": {"type": "string", "nullable": True},
        },
    },
    "DomainSearchResponse": {
        "type": "object",
        "required": ["query", "domains"],
        "properties": {
            "query": {"type": "string"},
            "domains": {
                "type": "array",
                "items": {"$ref": "#/components/schemas/DomainAvailability"},
            },
        },
    },
    "DomainPurchaseRequest": {
        "type": "object",
        "required": ["domain"],
        "properties": {
            "domain": {"type": "string", "example": "example.com"},
        },
    },
    "DomainPurchaseResponse": {
        "type": "object",
        "required": ["checkout_url", "domain", "total", "currency"],
        "properties": {
            "checkout_url": {"type": "string", "format": "uri"},
            "domain": {"type": "string"},
            "total": {"type": "string", "example": "12.99"},
            "currency": {"type": "string", "example": "USD"},
        },
    },
    "ConnectDomainRequest": {
        "type": "object",
        "required": ["domain", "provider"],
        "properties": {
            "domain": {"type": "string", "example": "www.example.com"},
            "provider": {
                "type": "string",
                "enum": ["external", "cloudflare", "namecheap"],
            },
        },
    },
    "DomainStatusResponse": {
        "type": "object",
        "required": ["domain", "status", "dns_verified"],
        "properties": {
            "domain": {"type": "string"},
            "status": {"type": "string", "example": "pending"},
            "provider": {"type": "string", "nullable": True},
            "dns_verified": {"type": "boolean"},
            "dns_message": {"type": "string", "nullable": True},
        },
    },
}

NEW_RESPONSES = {
    "PaymentRequired": {
        "description": "Payment or active subscription required",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/Error"}
            }
        },
    },
    "ServiceUnavailable": {
        "description": "Upstream service unavailable",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/Error"}
            }
        },
    },
}


def main() -> None:
    spec = yaml.safe_load(OPENAPI_PATH.read_text())

    spec["paths"].update(NEW_PATHS)
    spec["components"]["schemas"].update(NEW_SCHEMAS)
    spec["components"]["responses"].update(NEW_RESPONSES)

    # Bump version to reflect billing/domain additions.
    spec["info"]["version"] = "0.3.0"

    OPENAPI_PATH.write_text(yaml.dump(spec, sort_keys=False, allow_unicode=True))
    print(f"Updated {OPENAPI_PATH}")


if __name__ == "__main__":
    main()
