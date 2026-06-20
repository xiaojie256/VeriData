import os
import json
import logging
from datetime import datetime
from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
import requests  # 🔴 新增：用于将 Pandas 结构化中间体指标外包投喂给大模型

# 配置日志
log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
os.makedirs(log_dir, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(log_dir, 'ai_service.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

AI_INTERNAL_TOKEN = os.environ.get('AI_INTERNAL_TOKEN', '').strip()
AI_PROTECTED_PATHS = {'/analyze', '/quick-check', '/predict'}

UPLOAD_ROOT = os.environ.get('UPLOAD_ROOT', '/app/uploads')

def normalize_shared_upload_path(file_path):
    if not file_path:
        return file_path

    normalized = os.path.normpath(file_path)

    if os.path.exists(normalized):
        return normalized

    marker = f"{os.sep}uploads{os.sep}"

    if marker in normalized:
        relative_path = normalized.split(marker, 1)[1]
        candidate = os.path.join(UPLOAD_ROOT, relative_path)

        if os.path.exists(candidate):
            return candidate

    # 兼容 Windows 路径中包含 uploads 的情况
    lower_path = normalized.replace('\\', '/').lower()
    upload_index = lower_path.find('/uploads/')

    if upload_index >= 0:
      relative_path = normalized.replace('\\', '/')[upload_index + len('/uploads/'):]
      candidate = os.path.join(UPLOAD_ROOT, relative_path)

      if os.path.exists(candidate):
          return candidate

    return normalized


def make_json_safe(value):
    """递归转换 Pandas / NumPy 类型，确保 Flask jsonify 可以正常序列化"""
    if isinstance(value, dict):
        return {
            str(make_json_safe(key)): make_json_safe(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [make_json_safe(item) for item in value]

    if isinstance(value, tuple):
        return [make_json_safe(item) for item in value]

    if isinstance(value, np.integer):
        return int(value)

    if isinstance(value, np.floating):
        if np.isnan(value) or np.isinf(value):
            return None
        return float(value)

    if isinstance(value, np.bool_):
        return bool(value)

    if isinstance(value, np.ndarray):
        return make_json_safe(value.tolist())

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    return value


# AI检测核心类
class DataAnalyzer:
    def __init__(self):
        self.anomaly_threshold = 0.7
        
    def analyze_data(self, file_path, file_hash, llm_config=None):
        """分析数据文件，检测异常"""
        try:
            # 读取数据文件
            df = self._read_data(file_path)
            
            if df is None:
                return {
                    'score': 0,
                    'has_anomaly': True,
                    'details': {'error': '无法读取数据文件'}
                }
            
            analysis_result = {
                'file_info': {
                    'rows': len(df),
                    'columns': len(df.columns),
                    'file_hash': file_hash
                },
                'data_quality': self._check_data_quality(df),
                'statistical_analysis': self._statistical_analysis(df),
                'anomaly_detection': self._detect_anomalies(df),
                'consistency_check': self._check_consistency(df)
            }

            # 计算数据矩阵的特征指纹（用于后续克隆数据比对与多重验证提取）
            numeric_df = df.select_dtypes(include=[np.number])
            feature_fingerprint = {}
            if not numeric_df.empty:
                feature_fingerprint = {
                    "matrix_sum": float(numeric_df.sum().sum()),
                    "matrix_std_mean": float(numeric_df.std().mean()) if len(numeric_df) > 1 else 0.0,
                    "correlation_hash": float(numeric_df.corr().abs().sum().sum()) if len(numeric_df.columns) > 1 else 0.0
                }
            analysis_result['content_fingerprint'] = feature_fingerprint
            
            # 计算综合评分
            score = self._calculate_score(analysis_result)
            has_anomaly = score < 60 or analysis_result['anomaly_detection']['has_anomaly']
            
            # 外部大模型语义审计：配置由后端管理员配置中心传入
            llm_insight = self._get_llm_insight(analysis_result, score, llm_config or {})
            analysis_result['llm_insight'] = llm_insight
            
            return {
                'score': score,
                'has_anomaly': has_anomaly,
                'details': analysis_result
            }
            
        except Exception as e:
            logger.error(f"数据分析失败: {str(e)}")
            return {
                'score': 0,
                'has_anomaly': True,
                'details': {'error': str(e)}
            }
    
    def _read_data(self, file_path):
        """读取数据文件"""
        try:
            ext = os.path.splitext(file_path)[1].lower()
            
            if ext == '.csv':
                # 尝试 UTF-8 读取，失败则降级到 GB18030
                try:
                    return pd.read_csv(file_path, encoding='utf-8')
                except UnicodeDecodeError:
                    return pd.read_csv(file_path, encoding='gb18030')
            elif ext in ['.xlsx', '.xls']:
                return pd.read_excel(file_path)
            elif ext == '.json':
                return pd.read_json(file_path)
            elif ext == '.txt':
                # 尝试按表格格式解析
                try:
                    return pd.read_csv(file_path, sep='\t')
                except:
                    return None
            else:
                return None
        except Exception as e:
            logger.error(f"读取文件失败: {str(e)}")
            return None
    
    def _check_data_quality(self, df):
        """检查数据质量"""
        result = {
            'missing_values': {},
            'duplicate_rows': 0,
            'data_types': {}
        }
        
        # 缺失值检查
        for col in df.columns:
            missing_count = df[col].isnull().sum()
            missing_pct = (missing_count / len(df)) * 100
            result['missing_values'][col] = {
                'count': int(missing_count),
                'percentage': round(missing_pct, 2)
            }
        
        # 重复行检查
        result['duplicate_rows'] = int(df.duplicated().sum())
        
        # 数据类型
        result['data_types'] = {col: str(df[col].dtype) for col in df.columns}
        
        return result
    
    def _statistical_analysis(self, df):
        """统计分析"""
        result = {}
        
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        
        for col in numeric_cols:
            try:
                stats = {
                    'mean': round(df[col].mean(), 4),
                    'std': round(df[col].std(), 4),
                    'min': round(df[col].min(), 4),
                    'max': round(df[col].max(), 4),
                    'median': round(df[col].median(), 4),
                    'outliers': self._count_outliers(df[col])
                }
                result[col] = stats
            except:
                pass
        
        return result
    
    def _count_outliers(self, series):
        """使用IQR方法检测异常值"""
        try:
            Q1 = series.quantile(0.25)
            Q3 = series.quantile(0.75)
            IQR = Q3 - Q1
            lower_bound = Q1 - 1.5 * IQR
            upper_bound = Q3 + 1.5 * IQR
            outliers = ((series < lower_bound) | (series > upper_bound)).sum()
            return int(outliers)
        except:
            return 0
    
    def _detect_anomalies(self, df):
        """检测异常模式"""
        anomalies = []
        
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        
        for col in numeric_cols:
            try:
                # 检查是否有过多的零值
                zero_ratio = (df[col] == 0).sum() / len(df)
                if zero_ratio > 0.5:
                    anomalies.append({
                        'column': col,
                        'type': 'excessive_zeros',
                        'description': f'列"{col}"中{round(zero_ratio*100, 1)}%为零值'
                    })
                
                # 检查是否有不合理的数值范围
                if df[col].max() > df[col].mean() * 100 and df[col].std() > 0:
                    anomalies.append({
                        'column': col,
                        'type': 'extreme_values',
                        'description': f'列"{col}"存在极端大值'
                    })
                
                # 检查是否有重复值过多
                unique_ratio = df[col].nunique() / len(df)
                if unique_ratio < 0.01 and len(df) > 100:
                    anomalies.append({
                        'column': col,
                        'type': 'low_variance',
                        'description': f'列"{col}"唯一值比例过低({round(unique_ratio*100, 1)}%)'
                    })
                    
            except:
                pass
        
        # 检查数据分布异常
        if len(numeric_cols) >= 2:
            try:
                # 简单相关性检查
                corr_matrix = df[numeric_cols].corr()
                high_corr_pairs = []
                for i in range(len(corr_matrix.columns)):
                    for j in range(i+1, len(corr_matrix.columns)):
                        if abs(corr_matrix.iloc[i, j]) > 0.95:
                            high_corr_pairs.append({
                                'column1': corr_matrix.columns[i],
                                'column2': corr_matrix.columns[j],
                                'correlation': round(corr_matrix.iloc[i, j], 3)
                            })
                
                if high_corr_pairs:
                    anomalies.append({
                        'type': 'high_correlation',
                        'description': f'发现{len(high_corr_pairs)}对高度相关列',
                        'pairs': high_corr_pairs
                    })
            except:
                pass
        
        return {
            'has_anomaly': len(anomalies) > 0,
            'anomalies': anomalies,
            'anomaly_count': len(anomalies)
        }
    
    def _check_consistency(self, df):
        """检查数据一致性"""
        issues = []
        
        # 检查日期格式一致性
        for col in df.columns:
            if 'date' in col.lower() or 'time' in col.lower():
                try:
                    # 尝试转换为日期
                    pd.to_datetime(df[col], errors='raise')
                except:
                    issues.append({
                        'column': col,
                        'issue': 'date_format_inconsistent',
                        'description': f'列"{col}"日期格式不一致'
                    })
        
        # 检查字符串格式一致性
        for col in df.select_dtypes(include=['object']).columns:
            try:
                lengths = df[col].dropna().astype(str).str.len()
                if lengths.std() > lengths.mean() * 0.5:
                    issues.append({
                        'column': col,
                        'issue': 'length_variance',
                        'description': f'列"{col}"字符串长度差异较大'
                    })
            except:
                pass
        
        return {
            'has_issues': len(issues) > 0,
            'issues': issues
        }
    
    def _calculate_score(self, analysis):
        """计算数据质量评分"""
        score = 100
        
        # 缺失值扣分
        for col, info in analysis['data_quality']['missing_values'].items():
            if info['percentage'] > 50:
                score -= 15
            elif info['percentage'] > 20:
                score -= 10
            elif info['percentage'] > 5:
                score -= 5
        
        # 重复行扣分
        if analysis['data_quality']['duplicate_rows'] > 0:
            dup_ratio = analysis['data_quality']['duplicate_rows'] / analysis['file_info']['rows']
            score -= min(20, int(dup_ratio * 100))
        
        # 异常检测扣分
        if analysis['anomaly_detection']['has_anomaly']:
            score -= min(30, analysis['anomaly_detection']['anomaly_count'] * 5)
        
        # 一致性扣分
        if analysis['consistency_check']['has_issues']:
            score -= len(analysis['consistency_check']['issues']) * 3
        
        return max(0, round(score, 1))
    
    def _get_llm_insight(self, analysis, score, llm_config=None):
        """通过管理员配置的大模型获取语义审计意见"""
        try:
            llm_config = llm_config or {}

            if not llm_config.get('enabled'):
                reason = llm_config.get('disabled_reason') or '大模型语义审计未启用。'
                return reason

            api_base = str(llm_config.get('base_url') or '').strip().rstrip('/')
            api_key = str(llm_config.get('api_key') or '').strip()
            model = str(llm_config.get('model') or '').strip()
            temperature = float(llm_config.get('temperature', 0.3))
            max_tokens = int(llm_config.get('max_tokens', 500))
            timeout_ms = int(llm_config.get('timeout_ms', 30000))

            if not api_base or not api_key or not model:
                return "大模型配置不完整，无法获取语义审计报告。"
            
            # 构建大模型提示词
            anomaly_summary = "检测到的异常：" if analysis['anomaly_detection']['anomalies'] else "未发现明显异常"
            for anomaly in analysis['anomaly_detection']['anomalies'][:3]:
                anomaly_summary += f"\n  - {anomaly.get('description', anomaly.get('type'))}"
            
            prompt = f"""
作为数据质量审计专家，请对以下数据分析结果进行语义审计和合规性评估：

【数据基本信息】
- 数据规模：{analysis['file_info']['rows']} 行 × {analysis['file_info']['columns']} 列
- 自动化评分：{score}/100

【质量指标】
- 缺失值：{"无" if not any(v['percentage'] > 0 for v in analysis['data_quality']['missing_values'].values()) else "存在"}
- 重复行数：{analysis['data_quality']['duplicate_rows']}
- {anomaly_summary}

【一致性问题】
{len(analysis['consistency_check']['issues'])} 个问题已检出

请提供：
1. 数据质量总体评估
2. 主要风险识别
3. 合规性建议（对标数据治理最佳实践）
4. 后续审核重点

回复应简洁专业，字数控制在200字以内。
            """
            
            # 调用大模型
            response = requests.post(
                f"{api_base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是专业的数据质量审计专家，具有丰富的数据治理经验。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens
                },
                timeout=max(1, timeout_ms / 1000)
            )
            
            if response.status_code == 200:
                result = response.json()
                if 'choices' in result and len(result['choices']) > 0:
                    return result['choices'][0]['message']['content']
            
            return f"大模型调用失败（状态码：{response.status_code}），请查看后端日志。"
            
        except requests.exceptions.Timeout:
            return "大模型服务响应超时，请重试。"
        except requests.exceptions.ConnectionError:
            return "大模型服务连接失败，请检查网络配置。"
        except requests.exceptions.RequestException as e:
            logger.error(f"大模型请求异常: {str(e)}")
            return f"大模型请求异常：{str(e)}"
        except Exception as e:
            logger.error(f"大模型语义审计失败: {str(e)}")
            return f"大模型审计异常：{str(e)}"
    
    def quick_check(self, data_content):
        """公开快速检测：支持 CSV / TSV / JSON / 普通文本，并识别基础质量、隐私、安全与合规风险"""
        try:
            content = (data_content or '').strip()
            if not content:
                return {
                    'is_valid': False,
                    'message': '请提供数据内容',
                    'issues': ['数据内容为空'],
                    'issue_details': [],
                    'risk_level': 'high',
                    'format': 'unknown',
                    'score': 0,
                    'columns': [],
                    'rows': 0,
                    'preview': []
                }

            parsed = self._parse_public_content(content)
            df = parsed['df']
            data_format = parsed['format']

            if df is None or df.empty:
                return {
                    'is_valid': False,
                    'message': parsed.get('message') or '无法解析数据内容',
                    'issues': [parsed.get('message') or '无法解析数据内容'],
                    'issue_details': [{
                        'type': 'format_error',
                        'severity': 'high',
                        'message': parsed.get('message') or '无法解析数据内容'
                    }],
                    'risk_level': 'high',
                    'format': data_format,
                    'score': 0,
                    'columns': [],
                    'rows': 0,
                    'preview': []
                }

            issue_details = []
            issue_details.extend(self._check_public_quality_issues(df))
            issue_details.extend(self._check_public_privacy_issues(df, content))
            issue_details.extend(self._check_public_security_issues(content))
            issue_details.extend(self._check_public_fabrication_issues(df))
            issue_details.extend(self._check_public_numeric_anomalies(df))
            issue_details.extend(self._check_public_text_compliance_issues(content, data_format))

            issue_details = self._deduplicate_issue_details(issue_details)
            issues = [item['message'] for item in issue_details]

            severity_rank = {'low': 1, 'medium': 2, 'high': 3}
            max_severity = max([severity_rank.get(item.get('severity'), 1) for item in issue_details], default=0)
            if max_severity >= 3:
                risk_level = 'high'
            elif max_severity == 2:
                risk_level = 'medium'
            elif max_severity == 1:
                risk_level = 'low'
            else:
                risk_level = 'none'

            score = 100
            for item in issue_details:
                severity = item.get('severity')
                if severity == 'high':
                    score -= 25
                elif severity == 'medium':
                    score -= 12
                else:
                    score -= 5
            score = max(0, score)

            return {
                'is_valid': True,
                'format': data_format,
                'columns': [str(col) for col in df.columns],
                'rows': int(len(df)),
                'preview': df.head(5).where(pd.notnull(df), None).to_dict('records'),
                'issues': issues,
                'issue_details': issue_details,
                'risk_level': risk_level,
                'score': score,
                'summary': self._build_public_check_summary(data_format, len(df), len(df.columns), risk_level, issue_details)
            }

        except Exception as e:
            logger.error(f"公开快速检测失败: {str(e)}")
            return {
                'is_valid': False,
                'message': f'检测失败: {str(e)}',
                'issues': [f'检测失败: {str(e)}'],
                'issue_details': [{
                    'type': 'runtime_error',
                    'severity': 'high',
                    'message': f'检测失败: {str(e)}'
                }],
                'risk_level': 'high',
                'format': 'unknown',
                'score': 0,
                'columns': [],
                'rows': 0,
                'preview': []
            }

    def _parse_public_content(self, content):
        """解析公开检测输入，优先 JSON，其次 CSV/TSV，最后普通文本"""
        from io import StringIO

        stripped = content.lstrip()

        # JSON：支持数组、对象、对象内 records/data/items/list 字段
        if stripped.startswith('{') or stripped.startswith('['):
            try:
                parsed_json = json.loads(content)

                records = parsed_json
                if isinstance(parsed_json, dict):
                    for key in ['records', 'data', 'items', 'list', 'rows']:
                        if isinstance(parsed_json.get(key), list):
                            records = parsed_json[key]
                            break

                if isinstance(records, list):
                    if len(records) == 0:
                        return {'df': pd.DataFrame(), 'format': 'json', 'message': 'JSON 数组为空'}
                    if all(isinstance(item, dict) for item in records):
                        return {'df': pd.json_normalize(records), 'format': 'json'}
                    return {'df': pd.DataFrame({'value': records}), 'format': 'json'}

                if isinstance(records, dict):
                    return {'df': pd.json_normalize(records), 'format': 'json'}

                return {'df': pd.DataFrame({'value': [records]}), 'format': 'json'}
            except Exception as e:
                return {'df': None, 'format': 'json', 'message': f'JSON 解析失败: {str(e)}'}

        # CSV / TSV / 普通文本
        lines = [line.strip() for line in content.splitlines() if line.strip()]
        if not lines:
            return {'df': None, 'format': 'unknown', 'message': '数据内容为空'}

        separator = '\t' if '\t' in lines[0] else ','

        # 如果明显不是分隔型数据，不要交给 read_csv 硬读成一列表格
        if not self._looks_like_delimited_data(lines, separator):
            return {'df': pd.DataFrame({'text': lines}), 'format': 'text'}

        # 明显像 CSV/TSV，则解析失败时应判为格式错误，不应降级成 TEXT
        delimiter_issue = self._detect_delimited_format_issue(lines, separator)
        if delimiter_issue:
            return {'df': None, 'format': 'tsv' if separator == '\t' else 'csv', 'message': delimiter_issue}

        try:
            df = pd.read_csv(
                StringIO(content),
                sep=separator,
                engine='python',
                on_bad_lines='error'
            )
            return {'df': df, 'format': 'tsv' if separator == '\t' else 'csv'}
        except Exception as csv_error:
            return {
                'df': None,
                'format': 'tsv' if separator == '\t' else 'csv',
                'message': f'CSV/TSV 解析失败: {str(csv_error)}'
            }

    def _looks_like_delimited_data(self, lines, separator):
        """判断内容是否明显像 CSV/TSV，避免普通文本被 pandas 误读为一列表格"""
        if not lines:
            return False

        if separator not in lines[0]:
            return False

        sample_lines = lines[: min(len(lines), 10)]
        delimiter_lines = [line for line in sample_lines if separator in line]

        return len(delimiter_lines) >= max(2, len(sample_lines) // 2)

    def _detect_delimited_format_issue(self, lines, separator):
        """检测 CSV/TSV 是否存在列数不一致"""
        import csv
        from io import StringIO

        try:
            reader = csv.reader(StringIO('\n'.join(lines)), delimiter=separator)
            rows = list(reader)
        except Exception as e:
            return f'CSV/TSV 格式错误: {str(e)}'

        if len(rows) < 2:
            return '数据行数不足，至少需要表头和一行数据'

        expected_columns = len(rows[0])
        if expected_columns <= 1:
            return None

        bad_rows = []
        for index, row in enumerate(rows[1:], start=2):
            if len(row) != expected_columns:
                bad_rows.append(f'第 {index} 行列数为 {len(row)}，应为 {expected_columns}')

        if bad_rows:
            return 'CSV/TSV 列数不一致：' + '；'.join(bad_rows[:5])

        return None

    def _check_public_quality_issues(self, df):
        issues = []

        total_cells = max(1, int(df.shape[0] * df.shape[1]))
        missing_count = int(df.isnull().sum().sum())
        missing_ratio = missing_count / total_cells

        if missing_ratio > 0.3:
            issues.append({
                'type': 'missing_values',
                'severity': 'high',
                'message': f'数据缺失较多，缺失单元格占比约 {round(missing_ratio * 100, 1)}%'
            })
        elif missing_ratio > 0.1:
            issues.append({
                'type': 'missing_values',
                'severity': 'medium',
                'message': f'存在一定缺失值，缺失单元格占比约 {round(missing_ratio * 100, 1)}%'
            })

        duplicate_count = int(df.duplicated().sum())
        if duplicate_count > 0:
            duplicate_ratio = duplicate_count / max(1, len(df))
            severity = 'high' if duplicate_ratio > 0.3 else 'medium'
            issues.append({
                'type': 'duplicate_rows',
                'severity': severity,
                'message': f'存在重复数据，重复行数 {duplicate_count}，占比约 {round(duplicate_ratio * 100, 1)}%'
            })

        if len(df) < 3:
            issues.append({
                'type': 'small_sample',
                'severity': 'low',
                'message': '数据行数较少，检测结论可信度有限'
            })

        return issues

    def _check_public_privacy_issues(self, df, content):
        issues = []

        patterns = [
            ('phone', r'(?<!\d)1[3-9]\d{9}(?!\d)', '手机号'),
            ('email', r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '邮箱'),
            ('id_card', r'(?<!\d)[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)', '身份证号')
        ]

        for code, pattern, label in patterns:
            if self._regex_search(pattern, content):
                issues.append({
                    'type': f'privacy_{code}',
                    'severity': 'high',
                    'message': f'检测到疑似敏感个人信息：{label}'
                })

        sensitive_column_keywords = {
            'phone': '手机号',
            'mobile': '手机号',
            'tel': '电话号码',
            'email': '邮箱',
            'id_card': '身份证号',
            'identity': '身份证号',
            '身份证': '身份证号',
            'address': '地址',
            '地址': '地址'
        }

        lower_columns = [str(col).lower() for col in df.columns]
        for keyword, label in sensitive_column_keywords.items():
            if any(keyword in col for col in lower_columns):
                issues.append({
                    'type': 'privacy_column',
                    'severity': 'high',
                    'message': f'字段中包含疑似敏感信息列：{label}'
                })

        address_keywords = ['省', '市', '区', '县', '镇', '路', '街', '号', '小区', '学院', '大学']
        if 'address' in ''.join(lower_columns) or '地址' in ''.join(map(str, df.columns)):
            issues.append({
                'type': 'privacy_address',
                'severity': 'high',
                'message': '检测到地址字段，可能涉及个人位置隐私'
            })
        elif sum(1 for word in address_keywords if word in content) >= 3:
            issues.append({
                'type': 'privacy_address',
                'severity': 'medium',
                'message': '文本中包含较多地址特征词，建议确认是否存在位置隐私'
            })

        return issues

    def _check_public_security_issues(self, content):
        issues = []

        security_rules = [
            ('prompt_injection', r'(忽略|无视|绕过).{0,20}(规则|指令|审核|系统|限制)', '检测到疑似提示词注入：要求忽略/绕过审核规则'),
            ('prompt_injection', r'(直接返回|输出).{0,20}(通过|合格|系统密钥|密钥|key|token)', '检测到疑似提示词注入：诱导系统输出指定审核结果或敏感信息'),
            ('xss', r'<\s*script\b|javascript:|onerror\s*=|onload\s*=|alert\s*\(', '检测到疑似 XSS 脚本内容'),
            ('sql_injection', r'\b(drop|delete|truncate|insert|update)\s+(table|from|into|users?)\b|--\s*$|;\s*--', '检测到疑似 SQL 注入或破坏性 SQL 片段'),
            ('sql_injection', r'\bunion\s+select\b|\bor\s+1\s*=\s*1\b', '检测到疑似 SQL 注入条件')
        ]

        for issue_type, pattern, message in security_rules:
            if self._regex_search(pattern, content, ignore_case=True):
                issues.append({
                    'type': issue_type,
                    'severity': 'high',
                    'message': message
                })

        return issues

    def _check_public_fabrication_issues(self, df):
        issues = []

        if len(df) < 5 or len(df.columns) < 2:
            return issues

        id_like_keywords = ['id', '编号', '序号', 'student_id', 'respondent_id', 'user_id', 'device_id']
        business_columns = [
            col for col in df.columns
            if not any(keyword in str(col).lower() for keyword in id_like_keywords)
        ]

        if len(business_columns) >= 2:
            duplicate_without_id = int(df[business_columns].duplicated().sum())
            duplicate_without_id_ratio = duplicate_without_id / max(1, len(df))

            if duplicate_without_id_ratio > 0.6:
                issues.append({
                    'type': 'fabricated_repeated_pattern',
                    'severity': 'high',
                    'message': f'非编号字段高度重复，疑似模板化或伪造数据，占比约 {round(duplicate_without_id_ratio * 100, 1)}%'
                })
            elif duplicate_without_id_ratio > 0.3:
                issues.append({
                    'type': 'fabricated_repeated_pattern',
                    'severity': 'medium',
                    'message': f'非编号字段重复比例较高，占比约 {round(duplicate_without_id_ratio * 100, 1)}%'
                })

        constant_columns = []
        for col in business_columns:
            series = df[col].dropna().astype(str)
            if len(series) >= 5:
                top_ratio = series.value_counts(normalize=True).iloc[0]
                if top_ratio > 0.9:
                    constant_columns.append(str(col))

        if len(constant_columns) >= 2:
            issues.append({
                'type': 'low_variance_columns',
                'severity': 'high',
                'message': f'多个业务字段取值几乎完全一致，疑似分布异常：{", ".join(constant_columns[:5])}'
            })

        return issues

    def _check_public_numeric_anomalies(self, df):
        issues = []

        numeric_df = df.apply(pd.to_numeric, errors='ignore')
        numeric_columns = numeric_df.select_dtypes(include=[np.number]).columns

        for col in numeric_columns:
            series = numeric_df[col].dropna()
            if series.empty:
                continue

            col_name = str(col).lower()
            min_value = float(series.min())
            max_value = float(series.max())

            if any(key in col_name for key in ['humidity', '湿度']) and (min_value < 0 or max_value > 100):
                issues.append({
                    'type': 'numeric_physical_range',
                    'severity': 'high',
                    'message': f'字段 {col} 超出合理湿度范围 0-100'
                })

            if any(key in col_name for key in ['temperature', 'temp', '温度']) and (min_value < -80 or max_value > 80):
                issues.append({
                    'type': 'numeric_physical_range',
                    'severity': 'high',
                    'message': f'字段 {col} 存在不合理温度值'
                })

            if any(key in col_name for key in ['co2', '二氧化碳']) and (min_value < 0 or max_value > 10000):
                issues.append({
                    'type': 'numeric_physical_range',
                    'severity': 'high',
                    'message': f'字段 {col} 存在不合理 CO2 数值'
                })

            if len(series) >= 4:
                q1 = series.quantile(0.25)
                q3 = series.quantile(0.75)
                iqr = q3 - q1
                if iqr > 0:
                    outlier_count = int(((series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)).sum())
                    if outlier_count / len(series) > 0.2:
                        issues.append({
                            'type': 'numeric_outliers',
                            'severity': 'medium',
                            'message': f'字段 {col} 异常值比例较高，约 {round(outlier_count / len(series) * 100, 1)}%'
                        })

        return issues

    def _check_public_text_compliance_issues(self, content, data_format):
        issues = []

        compliance_rules = [
            (
                r'(伪造|编造|虚构|模拟生成|批量生成|代填|随便填)',
                '文本包含疑似伪造、代填或批量生成数据表述'
            ),
            (
                r'(不要|不要求|无需|避免|隐藏|不记录).{0,15}(来源|出处|授权|真实来源|数据来源)',
                '文本包含来源不明、未授权或规避来源记录的风险表述'
            ),
            (
                r'(来源不明|无法提供来源|未提供授权|未取得授权|没有授权)',
                '文本包含来源不明或授权不足风险'
            ),
            (
                r'(绕过|规避|跳过|逃避).{0,15}(审核|审查|检测|风控|平台审核)',
                '文本包含审核规避或干扰审核流程的风险表述'
            ),
            (
                r'(无条件|直接|自动|强制).{0,15}(通过|放行|合格)',
                '文本包含诱导系统直接通过审核的风险表述'
            )
        ]

        for pattern, message in compliance_rules:
            if self._regex_search(pattern, content, ignore_case=True):
                issues.append({
                    'type': 'text_compliance_risk',
                    'severity': 'high',
                    'message': message
                })

        return issues

    def _regex_search(self, pattern, text, ignore_case=False):
        import re
        flags = re.IGNORECASE if ignore_case else 0
        return re.search(pattern, text or '', flags) is not None

    def _deduplicate_issue_details(self, issues):
        seen = set()
        result = []
        for item in issues:
            key = (item.get('type'), item.get('message'))
            if key not in seen:
                seen.add(key)
                result.append(item)
        return result

    def _build_public_check_summary(self, data_format, rows, columns, risk_level, issue_details):
        if not issue_details:
            return f'已解析为 {data_format.upper()} 数据，共 {rows} 行、{columns} 列，未发现明显基础风险。'

        risk_label = {
            'high': '高风险',
            'medium': '中风险',
            'low': '低风险',
            'none': '未发现明显风险'
        }.get(risk_level, risk_level)

        return f'已解析为 {data_format.upper()} 数据，共 {rows} 行、{columns} 列，检测到 {len(issue_details)} 项问题，综合判断为{risk_label}。'

# 初始化分析器
analyzer = DataAnalyzer()

@app.before_request
def verify_internal_token():
    """保护 AI 服务内部接口，避免绕过后端直接调用。"""
    if request.path not in AI_PROTECTED_PATHS:
        return None

    if not AI_INTERNAL_TOKEN:
        logger.error('AI_INTERNAL_TOKEN 未配置，拒绝访问受保护的 AI 接口')
        return jsonify({'error': 'AI服务内部鉴权未配置'}), 503

    token = request.headers.get('X-Internal-Token', '').strip()
    if token != AI_INTERNAL_TOKEN:
        logger.warning(f'拒绝未授权 AI 内部接口请求: path={request.path}, remote={request.remote_addr}')
        return jsonify({'error': '无权访问AI内部服务'}), 401

    return None

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'service': 'ai-analysis'})

@app.route('/analyze', methods=['POST'])
def analyze():
    """分析数据文件"""
    try:
        data = request.json
        file_path = normalize_shared_upload_path(data.get('file_path'))
        file_hash = data.get('file_hash')
        llm_config = data.get('llm_config') or {}

        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': '文件不存在'}), 400

        logger.info(f"开始分析文件: {file_path}")
        result = analyzer.analyze_data(file_path, file_hash, llm_config)
        result = make_json_safe(result)

        if result.get('details', {}).get('error'):
            return jsonify(result), 422

        return jsonify(result)
        
    except Exception as e:
        logger.error(f"分析请求处理失败: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/quick-check', methods=['POST'])
def quick_check():
    """快速检测"""
    try:
        data = request.json
        content = data.get('data_content')
        
        if not content:
            return jsonify({'error': '请提供数据内容'}), 400
        
        result = analyzer.quick_check(content)
        return jsonify(make_json_safe(result))
        
    except Exception as e:
        logger.error(f"快速检测失败: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/predict', methods=['POST'])
def predict():
    """预测数据质量"""
    try:
        data = request.json
        preview = data.get('data_preview')
        
        # 基于数据预览进行简单预测
        rows = preview.get('rows', 0)
        cols = preview.get('columns', 0)
        
        # 简单评分规则
        predicted_score = 70
        
        if rows < 10:
            predicted_score -= 20
        elif rows < 100:
            predicted_score -= 10
        
        if cols < 3:
            predicted_score -= 10
        
        suggestions = []
        if rows < 10:
            suggestions.append('建议增加样本数据量')
        if cols < 3:
            suggestions.append('建议增加数据维度')
        
        return jsonify(make_json_safe({
            'predicted_score': max(0, predicted_score),
            'confidence': 'medium',
            'suggestions': suggestions
        }))
        
    except Exception as e:
        logger.error(f"预测失败: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # 根据环境变量控制debug模式，生产环境必须使用debug=False
    debug_mode = os.environ.get('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=5000, debug=debug_mode)
