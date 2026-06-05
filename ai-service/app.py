import os
import json
import logging
from datetime import datetime
from flask import Flask, request, jsonify
import pandas as pd
import numpy as np

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/app/logs/ai_service.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# AI检测核心类
class DataAnalyzer:
    def __init__(self):
        self.anomaly_threshold = 0.7
        
    def analyze_data(self, file_path, file_hash):
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
                return pd.read_csv(file_path)
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
    
    def quick_check(self, data_content):
        """快速检测数据内容"""
        try:
            # 尝试解析为DataFrame
            lines = data_content.strip().split('\n')
            
            if len(lines) < 2:
                return {
                    'is_valid': False,
                    'message': '数据行数不足'
                }
            
            # 简单CSV解析
            try:
                from io import StringIO
                df = pd.read_csv(StringIO(data_content))
                
                result = {
                    'is_valid': True,
                    'columns': list(df.columns),
                    'rows': len(df),
                    'preview': df.head(5).to_dict('records'),
                    'issues': []
                }
                
                # 快速检查
                if df.isnull().sum().sum() > len(df) * 0.1:
                    result['issues'].append('数据缺失较多')
                
                if df.duplicated().sum() > 0:
                    result['issues'].append('存在重复数据')
                
                return result
                
            except Exception as e:
                return {
                    'is_valid': False,
                    'message': f'解析失败: {str(e)}'
                }
                
        except Exception as e:
            return {
                'is_valid': False,
                'message': str(e)
            }

# 初始化分析器
analyzer = DataAnalyzer()

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'service': 'ai-analysis'})

@app.route('/analyze', methods=['POST'])
def analyze():
    """分析数据文件"""
    try:
        data = request.json
        file_path = data.get('file_path')
        file_hash = data.get('file_hash')
        
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': '文件不存在'}), 400
        
        logger.info(f"开始分析文件: {file_path}")
        result = analyzer.analyze_data(file_path, file_hash)
        
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
        return jsonify(result)
        
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
        
        return jsonify({
            'predicted_score': max(0, predicted_score),
            'confidence': 'medium',
            'suggestions': suggestions
        })
        
    except Exception as e:
        logger.error(f"预测失败: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # 根据环境变量控制debug模式，生产环境必须使用debug=False
    debug_mode = os.environ.get('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=5000, debug=debug_mode)
