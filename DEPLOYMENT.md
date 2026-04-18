# SafeWager VM Deployment

This repo is now set up for a single-VM deployment on GCP:

- `frontend/dist` is served by Nginx
- Nginx reverse-proxies backend routes to `127.0.0.1:4242`
- the backend runs as a `systemd` service
- the CS2 controller continues running on the same VM

## 1. Production env

Create `/home/collin/SafeWager/.env` on the VM from [.env.example](./.env.example).
Create `/home/collin/SafeWager/frontend/.env.production` for the Vite build.

Important production values:

- `NODE_ENV=production`
- `PORT=4242`
- `BACKEND_BASE_URL=https://your-domain-or-ip`
- `APP_ORIGIN=https://your-domain-or-ip`
- `ALLOWED_ORIGINS=https://your-domain-or-ip`
- `SESSION_SECRET=<long random string>`
- `STEAM_API_KEY=<your key>`
- `SECRET_KEY=<stripe secret>`
- `VITE_STRIPE_PUBLISHABLE_KEY=<stripe publishable>`
- `CS2_CONTROLLER_URL=http://127.0.0.1:4300`
- `CS2_CONTROLLER_TOKEN=<controller token>`

Frontend production values:

- `VITE_STRIPE_PUBLISHABLE_KEY=<stripe publishable>`
- `VITE_API_URL=` (leave blank for same-origin requests through Nginx)

If you are testing over plain HTTP first, use `http://...` values temporarily. For the final demo, move to HTTPS.

## 2. Install dependencies and build

From the repo root on the VM:

```bash
cd /home/collin/SafeWager
npm install --prefix backend
npm install --prefix frontend
npm run build --prefix frontend
```

## 3. Backend service

The template unit file is at [deploy/systemd/safewager-backend.service](./deploy/systemd/safewager-backend.service).

Copy it into `systemd`, then enable it:

```bash
sudo cp /home/collin/SafeWager/deploy/systemd/safewager-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now safewager-backend
sudo systemctl status safewager-backend
```

Adjust `User` and `WorkingDirectory` in the unit file if the repo lives somewhere else on the VM.

## 4. Nginx

The template config is at [deploy/nginx/safewager.conf](./deploy/nginx/safewager.conf).

Install and enable it:

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo cp /home/collin/SafeWager/deploy/nginx/safewager.conf /etc/nginx/sites-available/safewager
sudo ln -sf /etc/nginx/sites-available/safewager /etc/nginx/sites-enabled/safewager
sudo rm -f /etc/nginx/sites-enabled/default
sudo sh -c "printf 'safewager:%s\n' \"\$(openssl passwd -apr1 'replace-this-password')\" > /etc/nginx/.htpasswd-safewager"
sudo mkdir -p /var/www/safewager
sudo rsync -a --delete /home/collin/SafeWager/frontend/dist/ /var/www/safewager/
sudo chown -R www-data:www-data /var/www/safewager
sudo nginx -t
sudo systemctl reload nginx
```

If your backend port changes, update `proxy_pass http://127.0.0.1:4242`.
If you do not want preview password protection, remove the `auth_basic` lines from the Nginx config.

## 5. Firewall

Open public web traffic to the VM:

- TCP `80`
- TCP `443` after HTTPS is added

The CS2 game ports stay separate from the web app ports.

## 6. HTTPS

For Steam login and secure cookies, HTTPS is the correct end state.

Once your domain points at the VM:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

After HTTPS is live:

- keep `NODE_ENV=production`
- set both `BACKEND_BASE_URL` and `APP_ORIGIN` to `https://your-domain.com`
- update your Steam OpenID callback/allowed site settings to match the real public URL

## 7. Deploy updates

After code changes:

```bash
cd /home/collin/SafeWager
git pull
npm install --prefix backend
npm install --prefix frontend
npm run build --prefix frontend
sudo rsync -a --delete /home/collin/SafeWager/frontend/dist/ /var/www/safewager/
sudo chown -R www-data:www-data /var/www/safewager
sudo systemctl restart safewager-backend
sudo systemctl reload nginx
```

## Notes

- The frontend no longer requires a hardcoded localhost API URL.
- In development, the frontend still defaults to `http://localhost:4242`.
- In production, leave `VITE_API_URL` unset and let the frontend use same-origin requests through Nginx.
