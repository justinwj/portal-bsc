import type { NestExpressApplication } from '@nestjs/platform-express';
import { engine } from 'express-handlebars';
import { join } from 'path';

export function configureViews(app: NestExpressApplication) {
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: join(process.cwd(), 'views/layouts'),
    partialsDir: join(process.cwd(), 'views/partials'),
    helpers: { eq: (left: unknown, right: unknown) => left === right },
  }));
  app.setViewEngine('hbs');
}
