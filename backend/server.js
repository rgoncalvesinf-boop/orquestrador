const express = require('express');
const cors = require('cors');
const path = require('path');
const initSqlJs = require('sql.js');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Variável global para o banco
let db;

// Inicializar banco de dados
async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Carregar banco existente ou criar novo
  if (fs.existsSync('orquestrador.db')) {
    const fileBuffer = fs.readFileSync('orquestrador.db');
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Criar tabelas
  db.run(`
    CREATE TABLE IF NOT EXISTS disciplinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT,
      progresso INTEGER DEFAULT 0,
      total_aulas INTEGER DEFAULT 0,
      aulas_concluidas INTEGER DEFAULT 0,
      data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
      data_limite DATE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aulas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      disciplina_id INTEGER,
      titulo TEXT NOT NULL,
      tema TEXT,
      concluida INTEGER DEFAULT 0,
      data_conclusao DATETIME,
      FOREIGN KEY (disciplina_id) REFERENCES disciplinas(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS estudos_ingles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT CHECK(tipo IN ('livro', 'video', 'outro')),
      titulo TEXT NOT NULL,
      descricao TEXT,
      duracao_minutos INTEGER DEFAULT 0,
      concluida INTEGER DEFAULT 0,
      data_estudo DATE DEFAULT CURRENT_DATE,
      data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessoes_estudo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inicio DATETIME NOT NULL,
      fim DATETIME,
      duracao_segundos INTEGER,
      tipo TEXT,
      concluida INTEGER DEFAULT 0
    )
  `);

  saveDatabase();
  console.log('✅ Banco de dados inicializado com sucesso!');
}

// Salvar banco em arquivo
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync('orquestrador.db', buffer);
}

// Inicializar banco antes das rotas
initDatabase().then(() => {
  
  // ===== ROTAS DA API =====

  // ----- DISCIPLINAS -----
  app.get('/api/disciplinas', (req, res) => {
    const disciplinas = db.exec('SELECT * FROM disciplinas ORDER BY data_criacao DESC');
    const result = disciplinas.length > 0 ? disciplinas[0].values.map(row => ({
      id: row[0], nome: row[1], descricao: row[2], progresso: row[3],
      total_aulas: row[4], aulas_concluidas: row[5], data_criacao: row[6], data_limite: row[7]
    })) : [];
    res.json(result);
  });

  app.post('/api/disciplinas', (req, res) => {
    const { nome, descricao, total_aulas, data_limite } = req.body;
    db.run('INSERT INTO disciplinas (nome, descricao, total_aulas, data_limite) VALUES (?, ?, ?, ?)',
      [nome, descricao, total_aulas || 0, data_limite]);
    saveDatabase();
    const result = db.exec('SELECT last_insert_rowid()');
    res.json({ id: result[0].values[0][0], message: 'Disciplina criada com sucesso!' });
  });

  app.put('/api/disciplinas/:id/progresso', (req, res) => {
    const { id } = req.params;
    const { progresso, aulas_concluidas } = req.body;
    db.run('UPDATE disciplinas SET progresso = ?, aulas_concluidas = ? WHERE id = ?',
      [progresso, aulas_concluidas, id]);
    saveDatabase();
    res.json({ message: 'Progresso atualizado!' });
  });

  app.delete('/api/disciplinas/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM aulas WHERE disciplina_id = ?', [id]);
    db.run('DELETE FROM disciplinas WHERE id = ?', [id]);
    saveDatabase();
    res.json({ message: 'Disciplina excluída!' });
  });

  // ----- AULAS -----
  app.get('/api/disciplinas/:id/aulas', (req, res) => {
    const { id } = req.params;
    const aulas = db.exec('SELECT * FROM aulas WHERE disciplina_id = ? ORDER BY id', [id]);
    const result = aulas.length > 0 ? aulas[0].values.map(row => ({
      id: row[0], disciplina_id: row[1], titulo: row[2], tema: row[3],
      concluida: row[4], data_conclusao: row[5]
    })) : [];
    res.json(result);
  });

  app.post('/api/disciplinas/:id/aulas', (req, res) => {
    const { id } = req.params;
    const { titulo, tema } = req.body;
    db.run('INSERT INTO aulas (disciplina_id, titulo, tema) VALUES (?, ?, ?)', [id, titulo, tema]);
    
    // Atualizar total de aulas
    const total = db.exec('SELECT COUNT(*) FROM aulas WHERE disciplina_id = ?', [id]);
    db.run('UPDATE disciplinas SET total_aulas = ? WHERE id = ?', [total[0].values[0][0], id]);
    saveDatabase();
    
    const result = db.exec('SELECT last_insert_rowid()');
    res.json({ id: result[0].values[0][0], message: 'Aula adicionada!' });
  });

  app.put('/api/aulas/:id/toggle', (req, res) => {
    const { id } = req.params;
    const aula = db.exec('SELECT * FROM aulas WHERE id = ?', [id]);
    if (aula.length === 0) return res.status(404).json({ error: 'Aula não encontrada' });
    
    const aulaData = aula[0].values[0];
    const novoStatus = aulaData[4] ? 0 : 1;
    const dataConclusao = novoStatus ? new Date().toISOString() : null;
    
    db.run('UPDATE aulas SET concluida = ?, data_conclusao = ? WHERE id = ?',
      [novoStatus, dataConclusao, id]);
    
    // Atualizar progresso da disciplina
    const disciplina_id = aulaData[1];
    const total = db.exec('SELECT COUNT(*) FROM aulas WHERE disciplina_id = ?', [disciplina_id]);
    const concluidas = db.exec('SELECT COUNT(*) FROM aulas WHERE disciplina_id = ? AND concluida = 1', [disciplina_id]);
    const progresso = total[0].values[0][0] > 0 
      ? Math.round((concluidas[0].values[0][0] / total[0].values[0][0]) * 100) 
      : 0;
    
    db.run('UPDATE disciplinas SET progresso = ?, aulas_concluidas = ? WHERE id = ?',
      [progresso, concluidas[0].values[0][0], disciplina_id]);
    saveDatabase();
    
    res.json({ concluida: novoStatus, progresso });
  });

  // ----- INGLÊS -----
  app.get('/api/ingles', (req, res) => {
    const atividades = db.exec('SELECT * FROM estudos_ingles ORDER BY data_criacao DESC');
    const result = atividades.length > 0 ? atividades[0].values.map(row => ({
      id: row[0], tipo: row[1], titulo: row[2], descricao: row[3],
      duracao_minutos: row[4], concluida: row[5], data_estudo: row[6], data_criacao: row[7]
    })) : [];
    res.json(result);
  });

  app.post('/api/ingles', (req, res) => {
    const { tipo, titulo, descricao, duracao_minutos, concluida } = req.body;
    db.run('INSERT INTO estudos_ingles (tipo, titulo, descricao, duracao_minutos, concluida) VALUES (?, ?, ?, ?, ?)',
      [tipo, titulo, descricao, duracao_minutos || 0, concluida || 0]);
    saveDatabase();
    const result = db.exec('SELECT last_insert_rowid()');
    res.json({ id: result[0].values[0][0], message: 'Atividade registrada!' });
  });

  app.put('/api/ingles/:id', (req, res) => {
    const { id } = req.params;
    const { concluida, duracao_minutos } = req.body;
    db.run('UPDATE estudos_ingles SET concluida = ?, duracao_minutos = ? WHERE id = ?',
      [concluida, duracao_minutos, id]);
    saveDatabase();
    res.json({ message: 'Atualizado!' });
  });

  // ----- SESSÕES DE ESTUDO (CRONÔMETRO) -----
  app.post('/api/sessoes/iniciar', (req, res) => {
    const { tipo } = req.body;
    const inicio = new Date().toISOString();
    db.run('INSERT INTO sessoes_estudo (inicio, tipo) VALUES (?, ?)', [inicio, tipo || 'ingles']);
    saveDatabase();
    const result = db.exec('SELECT last_insert_rowid()');
    res.json({ id: result[0].values[0][0], inicio });
  });

  app.put('/api/sessoes/:id/finalizar', (req, res) => {
    const { id } = req.params;
    const fim = new Date().toISOString();
    const sessao = db.exec('SELECT * FROM sessoes_estudo WHERE id = ?', [id]);
    if (sessao.length === 0) return res.status(404).json({ error: 'Sessão não encontrada' });
    
    const inicio = new Date(sessao[0].values[0][1]);
    const duracao_segundos = Math.floor((new Date(fim) - inicio) / 1000);
    
    db.run('UPDATE sessoes_estudo SET fim = ?, duracao_segundos = ?, concluida = 1 WHERE id = ?',
      [fim, duracao_segundos, id]);
    saveDatabase();
    
    res.json({ duracao_segundos, duracao_minutos: Math.floor(duracao_segundos / 60) });
  });

  app.get('/api/sessoes/semana', (req, res) => {
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
    const dataLimite = seteDiasAtras.toISOString().split('T')[0];
    
    const sessoes = db.exec(`
      SELECT * FROM sessoes_estudo 
      WHERE concluida = 1 AND inicio >= ?
      ORDER BY inicio DESC
    `, [dataLimite]);
    
    const result = sessoes.length > 0 ? sessoes[0].values.map(row => ({
      id: row[0], inicio: row[1], fim: row[2], duracao_segundos: row[3],
      tipo: row[4], concluida: row[5]
    })) : [];
    
    const totalSegundos = result.reduce((acc, s) => acc + (s.duracao_segundos || 0), 0);
    const totalMinutos = Math.floor(totalSegundos / 60);
    const metaMinutos = 5 * 60; // 5 horas
    
    res.json({
      sessoes: result,
      total_minutos: totalMinutos,
      total_horas: (totalMinutos / 60).toFixed(1),
      meta_minutos: metaMinutos,
      progresso_meta: Math.round((totalMinutos / metaMinutos) * 100)
    });
  });

  // ----- DASHBOARD -----
  app.get('/api/dashboard', (req, res) => {
    const disciplinas = db.exec('SELECT * FROM disciplinas');
    const listaDisciplinas = disciplinas.length > 0 ? disciplinas[0].values : [];
    const progressoGeral = listaDisciplinas.length > 0
      ? Math.round(listaDisciplinas.reduce((acc, d) => acc + d[3], 0) / listaDisciplinas.length)
      : 0;
    
    const ingles = db.exec(`
      SELECT COUNT(*) as total, 
             SUM(CASE WHEN concluida = 1 THEN 1 ELSE 0 END) as concluidas,
             SUM(duracao_minutos) as total_minutos
      FROM estudos_ingles
    `);
    
    const inglesData = ingles.length > 0 ? ingles[0].values[0] : [0, 0, 0];
    
    res.json({
      disciplinas: listaDisciplinas.length,
      progresso_geral: progressoGeral,
      ingles_atividades: inglesData[0],
      ingles_concluidas: inglesData[1],
      ingles_total_minutos: inglesData[2] || 0
    });
  });

  // Servir o frontend (quando criarmos)
  app.use(express.static(path.join(__dirname, '../frontend')));
  
  app.get('*', (req, res) => {
    const frontendPath = path.join(__dirname, '../frontend/index.html');
    if (fs.existsSync(frontendPath)) {
      res.sendFile(frontendPath);
    } else {
      res.json({ 
        message: '🚀 API do Orquestrador rodando!',
        docs: {
          disciplinas: '/api/disciplinas',
          ingles: '/api/ingles',
          sessoes: '/api/sessoes/semana',
          dashboard: '/api/dashboard'
        }
      });
    }
  });

  // Iniciar servidor
  app.listen(PORT, () => {
    console.log(`🚀 Orquestrador rodando em http://localhost:${PORT}`);
    console.log(`📱 Acesse pelo navegador ou celular na mesma rede`);
  });

});